import { describe, expect, it } from 'vitest';
import { isValidCpf, maskCpf, isValidPhone, registrationSchema, passwordSchema } from '../../src/shared/validation.js';
import { encrypt, decrypt, cpfBlindIndex, randomCode } from '../../src/server/lib/crypto.js';
import { computePhase, isRegistrationWindow } from '../../src/server/services/events.js';
import { toCsv } from '../../src/server/services/reports-export.js';

describe('CPF e telefone', () => {
  it('aceita CPF válido e recusa dígitos errados ou repetidos', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('529.982.247-24')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('123')).toBe(false);
  });
  it('mascara o CPF sem revelar os 3 primeiros nem os 2 últimos dígitos', () => {
    expect(maskCpf('52998224725')).toBe('***.982.247-**');
  });
  it('valida telefone brasileiro com DDD', () => {
    expect(isValidPhone('(48) 99999-1234')).toBe(true);
    expect(isValidPhone('(48) 3333-1234')).toBe(true);
    expect(isValidPhone('(48) 89999-1234')).toBe(false);
    expect(isValidPhone('9999-1234')).toBe(false);
  });
});

describe('Formulários', () => {
  const base = { fullName: 'Maria da Silva', cpf: '529.982.247-25', email: 'maria@exemplo.org', phone: '(48) 99999-1234', schoolId: '00000000-0000-4000-8000-000000000001', privacyAck: true };
  it('exige ciência do aviso de privacidade', () => {
    expect(registrationSchema.safeParse(base).success).toBe(true);
    expect(registrationSchema.safeParse({ ...base, privacyAck: false }).success).toBe(false);
  });
  it('exige escola da lista ou o nome de outra instituição', () => {
    expect(registrationSchema.safeParse({ ...base, schoolId: undefined }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...base, schoolId: undefined, schoolOther: 'Creche Comunitária' }).success).toBe(true);
  });
  it('senha com 12+ caracteres, letras e números', () => {
    expect(passwordSchema.safeParse('curta1').success).toBe(false);
    expect(passwordSchema.safeParse('somenteletrasaqui').success).toBe(false);
    expect(passwordSchema.safeParse('SenhaForte12345').success).toBe(true);
  });
});

describe('Criptografia', () => {
  it('cifra e decifra com AES-GCM e detecta adulteração', () => {
    const c = encrypt('52998224725');
    expect(c.toString('utf8')).not.toContain('52998224725');
    expect(decrypt(c)).toBe('52998224725');
    c[c.length - 1] ^= 1;
    expect(() => decrypt(c)).toThrow();
  });
  it('índice cego é determinístico e não contém o CPF', () => {
    expect(cpfBlindIndex('52998224725').equals(cpfBlindIndex('52998224725'))).toBe(true);
    expect(cpfBlindIndex('52998224725').toString('hex')).not.toContain('52998224725');
  });
  it('códigos aleatórios usam só o alfabeto sem caracteres ambíguos', () => {
    for (let i = 0; i < 200; i++) expect(randomCode(16)).toMatch(/^[A-HJ-NP-Z2-9]{16}$/);
  });
});

describe('Fases do evento', () => {
  const d = (s: string) => new Date(s);
  const ev = { status: 'publicado' as const, registration_opens_at: d('2026-10-01T00:00:00Z'), registration_closes_at: d('2026-10-20T00:00:00Z') };
  const start = d('2026-10-15T12:00:00Z');
  const end = d('2026-10-16T21:00:00Z');
  it('calcula a fase pela data', () => {
    expect(computePhase(ev, start, end, d('2026-09-01T00:00:00Z'))).toBe('publicado');
    expect(computePhase(ev, start, end, d('2026-10-05T00:00:00Z'))).toBe('inscricoes_abertas');
    expect(computePhase(ev, start, end, d('2026-10-15T13:00:00Z'))).toBe('em_andamento');
    expect(computePhase({ ...ev, registration_closes_at: d('2026-10-10T00:00:00Z') }, start, end, d('2026-10-12T00:00:00Z'))).toBe('inscricoes_encerradas');
    expect(computePhase(ev, start, end, d('2026-10-17T00:00:00Z'))).toBe('concluido');
    expect(computePhase({ ...ev, status: 'rascunho' }, start, end, d('2026-10-05T00:00:00Z'))).toBe('rascunho');
  });
  it('inscrição fecha no prazo ou no fim do evento, o que vier antes', () => {
    expect(isRegistrationWindow(ev, end, d('2026-10-15T13:00:00Z'))).toBe(true);
    expect(isRegistrationWindow(ev, end, d('2026-10-17T00:00:00Z'))).toBe(false);
    expect(isRegistrationWindow({ ...ev, status: 'cancelado' }, end, d('2026-10-05T00:00:00Z'))).toBe(false);
  });
});

describe('CSV', () => {
  it('usa ";", BOM e neutraliza fórmulas', () => {
    const csv = toCsv([{ title: 'T', columns: [{ label: 'Nome', width: 1 }, { label: 'Obs', width: 1 }], rows: [['=HYPERLINK("x")', 'a;b']] }]).toString('utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain(`"'=HYPERLINK(""x"")";"a;b"`);
  });
});
