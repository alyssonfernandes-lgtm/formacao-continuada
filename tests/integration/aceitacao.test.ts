// Testes de aceitação (cenários 1 a 10 e 12 do documento de requisitos), executados contra
// PostgreSQL real e servidor SMTP local real. O cenário 11 (celular e desktop) está em tests/e2e.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getPool, closePool } from '../../src/server/db/pool.js';
import { processEmailQueue } from '../../src/server/services/email-queue.js';
import { anon, createUser, eventPayload, iso, loginAs, makeApp, registration, resetDb, startSmtp, type Client } from './helpers.js';

let app: FastifyInstance;
let admin: Client;
let pub: Client;
const db = () => getPool();

beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  await createUser('admin@teste.local', 'admin');
  await createUser('coord@teste.local', 'coordenacao');
  await createUser('cred@teste.local', 'credenciamento');
  await createUser('cred2@teste.local', 'credenciamento');
  await createUser('consulta@teste.local', 'consulta');
  admin = await loginAs(app, 'admin@teste.local');
  pub = anon(app);
});

afterAll(async () => {
  await app.close();
  await closePool();
});

async function newEvent(over: Record<string, unknown> = {}) {
  const r = await admin.inject('POST', '/api/admin/events', eventPayload(over));
  expect(r.status, r.body).toBe(201);
  return r.json.id as string;
}

async function register(eventId: string, n: number, over: Record<string, unknown> = {}) {
  return pub.inject('POST', `/api/public/events/${eventId}/registrations`, registration(n, over));
}

const sessionsOf = async (eventId: string) => (await admin.inject('GET', `/api/admin/events/${eventId}`)).json.sessions as { id: string }[];

describe('Cenário 1: inscrição gera protocolo e QR Code', () => {
  it('inscreve, devolve protocolo e token, e o QR Code não contém dados pessoais', async () => {
    const ev = await newEvent();
    const r = await register(ev, 1);
    expect(r.status, r.body).toBe(201);
    expect(r.json.protocol).toMatch(/^\d{4}-[A-Z2-9]{8}$/);
    expect(r.json.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.json.emailStatus).toBe('pendente');

    const page = await pub.inject('GET', `/api/public/registrations/${r.json.token}`);
    expect(page.status).toBe(200);
    expect(page.json.protocol).toBe(r.json.protocol);
    expect(JSON.stringify(page.json)).not.toContain(registration(1).cpf);

    const svg = await pub.inject('GET', `/api/public/registrations/${r.json.token}/qr.svg`);
    expect(svg.status).toBe(200);
    expect(svg.headers['content-type']).toContain('image/svg+xml');

    // No banco o CPF fica cifrado e o token só aparece como hash
    const row = (await db().query(`SELECT p.cpf_enc, p.cpf_masked, r.qr_token_hash FROM registrations r JOIN participants p ON p.id = r.participant_id WHERE r.protocol = $1`, [r.json.protocol])).rows[0];
    expect(row.cpf_enc.toString('latin1')).not.toContain(registration(1).cpf);
    expect(row.cpf_masked).toMatch(/^\*\*\*\.\d{3}\.\d{3}-\*\*$/);
  });

  it('valida CPF, telefone, e-mail e nome no servidor', async () => {
    const ev = await newEvent();
    const r = await register(ev, 2, { cpf: '111.111.111-11', phone: '123', email: 'x', fullName: 'A' });
    expect(r.status).toBe(400);
    expect(Object.keys(r.json.fields).sort()).toEqual(['cpf', 'email', 'fullName', 'phone']);
    expect(r.body).not.toContain('11111111111');
  });

  it('impede inscrição duplicada no mesmo evento, mas permite em outro evento', async () => {
    const ev1 = await newEvent();
    const ev2 = await newEvent({ title: 'Outro evento' });
    expect((await register(ev1, 3)).status).toBe(201);
    const dup = await register(ev1, 3, { email: 'outro@teste.local' });
    expect(dup.status).toBe(409);
    expect(dup.json.error).toBe('ja_inscrito');
    expect((await register(ev2, 3)).status).toBe(201);
  });

  it('inscrições simultâneas não ultrapassam o limite de vagas', async () => {
    const ev = await newEvent({ capacity: 5 });
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => register(ev, 100 + i)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 409 && r.json.error === 'vagas_esgotadas')).toHaveLength(15);
    const n = (await db().query(`SELECT count(*)::int AS n FROM registrations WHERE event_id = $1 AND status = 'confirmada'`, [ev])).rows[0].n;
    expect(n).toBe(5);
  });

  it('o mesmo CPF enviado em paralelo gera uma única inscrição', async () => {
    const ev = await newEvent();
    const results = await Promise.all(Array.from({ length: 8 }, () => register(ev, 200)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
  });

  it('recusa inscrição fora do prazo e em rascunho', async () => {
    const closed = await newEvent({ registrationOpensAt: iso(-3000), registrationClosesAt: iso(-60) });
    expect((await register(closed, 300)).json.error).toBe('inscricoes_fechadas');
    const draft = await newEvent({ status: 'rascunho' });
    expect((await register(draft, 301)).status).toBe(409);
    expect((await pub.inject('GET', `/api/public/events/${draft}`)).status).toBe(404);
  });
});

describe('Cenário 2 e 8: e-mail de confirmação, estado registrado e falhas', () => {
  it('envia por SMTP real e marca "enviado" somente após o aceite do servidor', async () => {
    const box = await startSmtp();
    try {
      const ev = await newEvent();
      const r = await register(ev, 400);
      const before = await db().query(`SELECT m.status FROM email_messages m JOIN registrations r ON r.id = m.registration_id WHERE r.protocol = $1`, [r.json.protocol]);
      expect(before.rows[0].status).toBe('pendente');
      await processEmailQueue(100);
      const after = await db().query(`SELECT m.status, m.sent_at, m.provider_message_id FROM email_messages m JOIN registrations r ON r.id = m.registration_id WHERE r.protocol = $1`, [r.json.protocol]);
      expect(after.rows[0].status).toBe('enviado');
      expect(after.rows[0].provider_message_id).toBeTruthy();
      const mail = box.messages.find((m) => m.to.includes('prof400@teste.local'));
      expect(mail).toBeTruthy();
      expect(mail!.raw).toContain(r.json.protocol);
      expect(mail!.raw).toContain('Content-ID: <qrcode>');
      expect(mail!.raw).not.toContain(registration(400).cpf);
      const page = await pub.inject('GET', `/api/public/registrations/${r.json.token}`);
      expect(page.json.emailStatus).toBe('enviado');
    } finally {
      await box.close();
    }
  });

  it('com o servidor SMTP fora do ar, mantém "pendente" com erro e agenda nova tentativa', async () => {
    const ev = await newEvent();
    const r = await register(ev, 401);
    await processEmailQueue(100);
    const m = (await db().query(`SELECT m.status, m.attempts, m.last_error, m.next_attempt_at FROM email_messages m JOIN registrations r ON r.id = m.registration_id WHERE r.protocol = $1`, [r.json.protocol])).rows[0];
    expect(m.status).toBe('pendente');
    expect(m.attempts).toBe(1);
    expect(m.last_error).toMatch(/ECONNREFUSED|connect/i);
    expect(new Date(m.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('destinatário recusado esgota as tentativas, fica "falhou", é visível no painel e a nova tentativa não duplica', async () => {
    const box = await startSmtp(2526, { reject: true });
    const ev = await newEvent();
    const r = await register(ev, 402);
    const id = (await db().query(`SELECT m.id FROM email_messages m JOIN registrations r ON r.id = m.registration_id WHERE r.protocol = $1`, [r.json.protocol])).rows[0].id;
    try {
      for (let i = 0; i < 6; i++) {
        await db().query(`UPDATE email_messages SET next_attempt_at = now() WHERE id = $1 AND status = 'pendente'`, [id]);
        await processEmailQueue(100);
      }
    } finally {
      await box.close();
    }
    const m = (await db().query(`SELECT status, attempts, last_error FROM email_messages WHERE id = $1`, [id])).rows[0];
    expect(m.status).toBe('falhou');
    expect(m.attempts).toBe(6);
    const list = await admin.inject('GET', '/api/admin/emails?status=falhou');
    expect(list.json.messages.some((x: { id: string }) => x.id === id)).toBe(true);

    const ok = await startSmtp();
    try {
      expect((await admin.inject('POST', `/api/admin/emails/${id}/retry`)).status).toBe(200);
      expect((await admin.inject('POST', `/api/admin/emails/${id}/retry`)).status).toBe(409);
      await processEmailQueue(100);
      expect((await db().query(`SELECT status FROM email_messages WHERE id = $1`, [id])).rows[0].status).toBe('enviado');
      expect(ok.messages.filter((x) => x.to.includes('prof402@teste.local'))).toHaveLength(1);
      expect((await db().query(`SELECT count(*)::int AS n FROM registrations WHERE protocol = $1`, [r.json.protocol])).rows[0].n).toBe(1);
    } finally {
      await ok.close();
    }
  });
});

describe('Cenário 3 e 10: autenticação e acesso indevido', () => {
  it('coordenação entra com credenciais válidas e senha errada é recusada', async () => {
    const c = await loginAs(app, 'coord@teste.local');
    const me = await c.inject('GET', '/api/auth/me');
    expect(me.json.user.role).toBe('coordenacao');
    const bad = await pub.inject('POST', '/api/auth/login', { email: 'coord@teste.local', password: 'errada' });
    expect(bad.status).toBe(401);
  });

  it('bloqueia a conta após 5 tentativas erradas', async () => {
    await createUser('alvo@teste.local', 'coordenacao');
    for (let i = 0; i < 5; i++) await pub.inject('POST', '/api/auth/login', { email: 'alvo@teste.local', password: 'errada' });
    const r = await pub.inject('POST', '/api/auth/login', { email: 'alvo@teste.local', password: 'SenhaForte12345' });
    expect(r.status).toBe(423);
  });

  it('limita tentativas de login por IP (rate limiting)', async () => {
    const same = anon(app, '192.0.2.10');
    const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await same.inject('POST', '/api/auth/login', { email: `naoexiste${i}@teste.local`, password: 'x' })).status);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });

  it('sem sessão, nenhuma rota administrativa responde', async () => {
    for (const url of ['/api/admin/events', '/api/admin/settings', '/api/admin/reports/indicators', '/api/admin/checkin/events', '/api/admin/audit']) {
      expect((await pub.inject('GET', url)).status).toBe(401);
    }
  });

  it('cada perfil acessa apenas o que lhe cabe (menor privilégio)', async () => {
    const consulta = await loginAs(app, 'consulta@teste.local');
    const cred = await loginAs(app, 'cred@teste.local');
    const coord = await loginAs(app, 'coord@teste.local');
    expect((await consulta.inject('POST', '/api/admin/events', eventPayload())).status).toBe(403);
    expect((await consulta.inject('GET', '/api/admin/reports/indicators')).status).toBe(200);
    expect((await consulta.inject('POST', '/api/admin/reports/export', { kind: 'inscritos', format: 'csv' })).status).toBe(403);
    expect((await consulta.inject('POST', '/api/admin/reports/export', { kind: 'resumo', format: 'csv' })).status).toBe(200);
    expect((await cred.inject('GET', '/api/admin/reports/indicators')).status).toBe(403);
    expect((await cred.inject('GET', '/api/admin/events')).status).toBe(403);
    expect((await coord.inject('GET', '/api/admin/settings')).status).toBe(403);
    expect((await coord.inject('GET', '/api/admin/audit')).status).toBe(403);
    expect((await coord.inject('POST', '/api/admin/users', { name: 'X', email: 'x@x.com', role: 'admin', password: 'SenhaForte12345' })).status).toBe(403);
  });

  it('requisição alterando dados sem token CSRF é recusada', async () => {
    const c = await loginAs(app, 'coord@teste.local');
    const r = await app.inject({ method: 'POST', url: '/api/admin/events', payload: eventPayload(), headers: { cookie: c.cookie } });
    expect(r.statusCode).toBe(403);
    const o = await app.inject({ method: 'POST', url: '/api/public/events/00000000-0000-0000-0000-000000000000/registrations', payload: {}, headers: { origin: 'https://site-malicioso.example' } });
    expect(o.statusCode).toBe(403);
  });

  it('o QR Code sozinho não dá acesso administrativo', async () => {
    const ev = await newEvent();
    const r = await register(ev, 500);
    const res = await app.inject({ method: 'GET', url: '/api/admin/events', headers: { cookie: `fc_sess=${r.json.token}` } });
    expect(res.statusCode).toBe(401);
  });
});

describe('Cenários 4, 5 e 6: credenciamento por QR Code', () => {
  let ev: string;
  let session: string;
  let token: string;
  let qrUrl: string;
  beforeAll(async () => {
    ev = await newEvent({ title: 'Seminário de Credenciamento' });
    session = (await sessionsOf(ev))[0].id;
    const r = await register(ev, 600);
    token = r.json.token;
    qrUrl = `http://localhost:3000/i/${token}`;
  });

  it('registra presença com horário do servidor e operador', async () => {
    const coord = await loginAs(app, 'coord@teste.local');
    const r = await coord.inject('POST', '/api/admin/checkin', { eventId: ev, sessionId: session, raw: qrUrl });
    expect(r.json.result).toBe('registrado');
    expect(r.json.participant.name).toBe(registration(600).fullName);
    expect(JSON.stringify(r.json)).not.toContain(registration(600).cpf);
    const a = (await db().query(`SELECT a.checked_in_at, u.email FROM attendances a JOIN users u ON u.id = a.checked_in_by`)).rows;
    expect(a).toHaveLength(1);
    expect(a[0].email).toBe('coord@teste.local');
    expect(Math.abs(new Date(a[0].checked_in_at).getTime() - Date.now())).toBeLessThan(60_000);
  });

  it('segunda leitura e leituras simultâneas não duplicam a presença', async () => {
    const coord = await loginAs(app, 'coord@teste.local');
    const again = await coord.inject('POST', '/api/admin/checkin', { eventId: ev, sessionId: session, raw: token });
    expect(again.json.result).toBe('ja_registrado');
    const r2 = await register(ev, 601);
    const results = await Promise.all(Array.from({ length: 10 }, () => coord.inject('POST', '/api/admin/checkin', { eventId: ev, sessionId: session, raw: r2.json.token })));
    expect(results.filter((x) => x.json.result === 'registrado')).toHaveLength(1);
    expect(results.filter((x) => x.json.result === 'ja_registrado')).toHaveLength(9);
    const n = (await db().query(`SELECT count(*)::int AS n FROM attendances a JOIN registrations r ON r.id = a.registration_id WHERE r.protocol = $1`, [r2.json.protocol])).rows[0].n;
    expect(n).toBe(1);
  });

  it('recusa QR inválido, inexistente, de outro evento e de inscrição cancelada', async () => {
    const coord = await loginAs(app, 'coord@teste.local');
    const send = (raw: string) => coord.inject('POST', '/api/admin/checkin', { eventId: ev, sessionId: session, raw });
    expect((await send('https://exemplo.com/qualquer-coisa')).json.result).toBe('qr_invalido');
    expect((await send('A'.repeat(43))).json.result).toBe('nao_localizada');
    const other = await newEvent({ title: 'Evento B' });
    const ro = await register(other, 602);
    const o = await send(ro.json.token);
    expect(o.json.result).toBe('outro_evento');
    expect(o.json.participant).toBeUndefined();
    const rc = await register(ev, 603);
    const regId = (await db().query(`SELECT id FROM registrations WHERE protocol = $1`, [rc.json.protocol])).rows[0].id;
    expect((await coord.inject('POST', `/api/admin/registrations/${regId}/cancel`, { reason: 'Desistência informada' })).status).toBe(200);
    expect((await send(rc.json.token)).json.result).toBe('inscricao_cancelada');
  });

  it('QR Code substituído deixa de valer imediatamente', async () => {
    const coord = await loginAs(app, 'coord@teste.local');
    const r = await register(ev, 604);
    const regId = (await db().query(`SELECT id FROM registrations WHERE protocol = $1`, [r.json.protocol])).rows[0].id;
    expect((await coord.inject('POST', `/api/admin/registrations/${regId}/rotate-qr`, { reason: 'Celular extraviado' })).status).toBe(200);
    expect((await coord.inject('POST', '/api/admin/checkin', { eventId: ev, sessionId: session, raw: r.json.token })).json.result).toBe('nao_localizada');
  });

  it('operador de credenciamento só atua nos eventos designados', async () => {
    const cred = await loginAs(app, 'cred@teste.local');
    const r = await register(ev, 605);
    expect((await cred.inject('POST', '/api/admin/checkin', { eventId: ev, sessionId: session, raw: r.json.token })).json.result).toBe('evento_nao_autorizado');
    const credId = (await db().query(`SELECT id FROM users WHERE email = 'cred@teste.local'`)).rows[0].id;
    expect((await admin.inject('PUT', `/api/admin/events/${ev}/staff`, { userIds: [credId] })).status).toBe(200);
    const ok = await cred.inject('POST', '/api/admin/checkin', { eventId: ev, sessionId: session, raw: r.json.token });
    expect(ok.json.result).toBe('registrado');
    expect(Object.keys(ok.json.participant).sort()).toEqual(['name', 'protocol', 'school']);
    const cred2 = await loginAs(app, 'cred2@teste.local');
    expect((await cred2.inject('GET', `/api/admin/checkin/search?eventId=${ev}&sessionId=${session}&q=Professora`)).status).toBe(403);
  });

  it('recusa check-in fora da janela da sessão', async () => {
    const future = await newEvent({ sessions: [{ startsAt: iso(60 * 24 * 3), endsAt: iso(60 * 24 * 3 + 120), hours: 2 }] });
    const s = (await sessionsOf(future))[0].id;
    const r = await register(future, 606);
    expect((await admin.inject('POST', '/api/admin/checkin', { eventId: future, sessionId: s, raw: r.json.token })).json.result).toBe('fora_da_janela');
  });

  it('correção manual exige justificativa e fica auditada', async () => {
    const coord = await loginAs(app, 'coord@teste.local');
    const r = await register(ev, 607);
    const regId = (await db().query(`SELECT id FROM registrations WHERE protocol = $1`, [r.json.protocol])).rows[0].id;
    expect((await coord.inject('POST', '/api/admin/attendances', { registrationId: regId, sessionId: session, justification: '' })).status).toBe(400);
    const ok = await coord.inject('POST', '/api/admin/attendances', { registrationId: regId, sessionId: session, justification: 'Leitor sem bateria, lista assinada' });
    expect(ok.status).toBe(201);
    const audit = (await db().query(`SELECT details FROM audit_logs WHERE action = 'presenca.incluir_correcao'`)).rows;
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0].details)).not.toContain(registration(607).cpf);
    expect((await coord.inject('POST', `/api/admin/attendances/${ok.json.id}/revoke`, { reason: 'abc' })).status).toBe(400);
    expect((await coord.inject('POST', `/api/admin/attendances/${ok.json.id}/revoke`, { reason: 'Registrado por engano' })).status).toBe(200);
  });
});

describe('Cenários 7 e 8: certificados somente para elegíveis, sem duplicidade', () => {
  it('emite apenas para quem cumpre o critério, não duplica, permite reemissão e verificação', async () => {
    const box = await startSmtp();
    try {
      const ev = await newEvent({
        title: 'Curso em Três Encontros',
        workloadHours: 12,
        certCriterion: 'todas_sessoes',
        certSignerName: '',
        sessions: [
          { title: 'Encontro 1', startsAt: iso(-30), endsAt: iso(90), hours: 4 },
          { title: 'Encontro 2', startsAt: iso(-20), endsAt: iso(100), hours: 4 },
          { title: 'Encontro 3', startsAt: iso(-10), endsAt: iso(110), hours: 4 },
        ],
      });
      const sess = await sessionsOf(ev);
      const full = await register(ev, 700);
      const partial = await register(ev, 701);
      const absent = await register(ev, 702);
      for (const s of sess) await admin.inject('POST', '/api/admin/checkin', { eventId: ev, sessionId: s.id, raw: full.json.token });
      await admin.inject('POST', '/api/admin/checkin', { eventId: ev, sessionId: sess[0].id, raw: partial.json.token });

      // Antes do encerramento a emissão é recusada
      expect((await admin.inject('POST', `/api/admin/events/${ev}/certificates/release`)).json.error).toBe('evento_nao_encerrado');

      // Encerra o evento (desloca as sessões para o passado)
      await db().query(`UPDATE event_sessions SET starts_at = starts_at - interval '2 days', ends_at = ends_at - interval '2 days' WHERE event_id = $1`, [ev]);
      const rel = await admin.inject('POST', `/api/admin/events/${ev}/certificates/release`);
      expect(rel.json.created).toBe(1);
      const again = await admin.inject('POST', `/api/admin/events/${ev}/certificates/release`);
      expect(again.json.created).toBe(0);
      const certs = (await db().query(`SELECT c.*, r.protocol FROM certificates c JOIN registrations r ON r.id = c.registration_id WHERE r.event_id = $1`, [ev])).rows;
      expect(certs).toHaveLength(1);
      expect(certs[0].protocol).toBe(full.json.protocol);
      expect(Number(certs[0].hours)).toBe(12);

      await processEmailQueue(100);
      const mails = box.messages.filter((m) => m.raw.includes('Certificado'));
      expect(mails.map((m) => m.to[0])).toEqual(['prof700@teste.local']);
      expect(mails[0].raw).toContain('application/pdf');

      // Verificação pública
      const v = await pub.inject('GET', `/api/public/certificates/${certs[0].verification_code}`);
      expect(v.json.status).toBe('valido');
      expect(v.json.participantName).toBe(registration(700).fullName);
      const pdf = await pub.inject('GET', `/api/public/certificates/${certs[0].verification_code}/pdf`);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(pdf.raw.subarray(0, 4).toString()).toBe('%PDF');
      expect((await pub.inject('GET', '/api/public/certificates/AAAA-BBBB-CCCC-DDDD')).status).toBe(404);

      // Reemissão: anterior fica "substituído", o novo é válido, histórico mantido
      const re = await admin.inject('POST', `/api/admin/certificates/${certs[0].id}/reissue`, { reason: 'Correção do nome' });
      expect(re.status).toBe(200);
      const v2 = await pub.inject('GET', `/api/public/certificates/${certs[0].verification_code}`);
      expect(v2.json.status).toBe('substituido');
      expect(v2.json.replacedByCode).toBeTruthy();
      expect((await pub.inject('GET', `/api/public/certificates/${certs[0].verification_code}/pdf`)).status).toBe(404);
      const valid = (await db().query(`SELECT count(*)::int AS n FROM certificates c JOIN registrations r ON r.id = c.registration_id WHERE r.event_id = $1 AND c.status = 'valido'`, [ev])).rows[0].n;
      expect(valid).toBe(1);

      // Falha de e-mail do certificado é identificável e o reenvio não cria outro certificado
      await processEmailQueue(100);
      const newCert = re.json.id;
      expect((await admin.inject('POST', `/api/admin/certificates/${newCert}/resend`)).status).toBe(200);
      expect((await admin.inject('POST', `/api/admin/certificates/${newCert}/resend`)).status).toBe(409);
      expect((await db().query(`SELECT count(*)::int AS n FROM certificates c JOIN registrations r ON r.id = c.registration_id WHERE r.event_id = $1`, [ev])).rows[0].n).toBe(2);

      // Inscrição parcial: não elegível individualmente
      const partialId = (await db().query(`SELECT id FROM registrations WHERE protocol = $1`, [partial.json.protocol])).rows[0].id;
      expect((await admin.inject('POST', `/api/admin/registrations/${partialId}/certificate`)).json.error).toBe('nao_elegivel');
      expect(absent.status).toBe(201);
    } finally {
      await box.close();
    }
  });

  it('critério de percentual mínimo com carga proporcional', async () => {
    const ev = await newEvent({
      title: 'Curso por Frequência',
      workloadHours: 10,
      certCriterion: 'percentual_minimo',
      certMinPercent: 75,
      certHoursMode: 'proporcional',
      sessions: [1, 2, 3, 4].map((i) => ({ title: `S${i}`, startsAt: iso(-40 + i), endsAt: iso(100 + i), hours: 2.5 })),
    });
    const sess = await sessionsOf(ev);
    const a = await register(ev, 800);
    const b = await register(ev, 801);
    for (const s of sess.slice(0, 3)) await admin.inject('POST', '/api/admin/checkin', { eventId: ev, sessionId: s.id, raw: a.json.token });
    for (const s of sess.slice(0, 2)) await admin.inject('POST', '/api/admin/checkin', { eventId: ev, sessionId: s.id, raw: b.json.token });
    await db().query(`UPDATE event_sessions SET starts_at = starts_at - interval '2 days', ends_at = ends_at - interval '2 days' WHERE event_id = $1`, [ev]);
    expect((await admin.inject('POST', `/api/admin/events/${ev}/certificates/release`)).json.created).toBe(1);
    const c = (await db().query(`SELECT c.hours, r.protocol FROM certificates c JOIN registrations r ON r.id = c.registration_id WHERE r.event_id = $1`, [ev])).rows;
    expect(c).toEqual([{ hours: 7.5, protocol: a.json.protocol }]);
  });
});

describe('Cenário 9: relatórios consistentes com inscrições e presenças', () => {
  it('totais batem com o banco e não confundem inscrições com pessoas', async () => {
    const ev1 = await newEvent({ title: 'Relatório A' });
    const ev2 = await newEvent({ title: 'Relatório B', sessions: [{ startsAt: iso(60 * 24 * 5), endsAt: iso(60 * 24 * 5 + 60), hours: 1 }] });
    const s1 = (await sessionsOf(ev1))[0].id;
    const regs = [];
    for (let i = 0; i < 4; i++) regs.push(await register(ev1, 900 + i));
    // A mesma pessoa (900) também no evento B: 2 inscrições, 1 pessoa
    await register(ev2, 900);
    await register(ev2, 910);
    await admin.inject('POST', '/api/admin/checkin', { eventId: ev1, sessionId: s1, raw: regs[0].json.token });
    await admin.inject('POST', '/api/admin/checkin', { eventId: ev1, sessionId: s1, raw: regs[1].json.token });
    const cancelId = (await db().query(`SELECT id FROM registrations WHERE protocol = $1`, [regs[3].json.protocol])).rows[0].id;
    await admin.inject('POST', `/api/admin/registrations/${cancelId}/cancel`, { reason: 'Cancelamento a pedido' });

    const one = (await admin.inject('GET', `/api/admin/reports/indicators?eventId=${ev1}`)).json.totals;
    expect(one).toMatchObject({ totalRegistrations: 4, confirmed: 3, cancelled: 1, present: 2, absent: 1, awaiting: 0, uniqueParticipants: 3, attendanceRate: 66.7 });

    const all = (await admin.inject('GET', `/api/admin/reports/indicators`)).json;
    const truth = (await db().query(`SELECT count(*) FILTER (WHERE status='confirmada')::int AS c, count(DISTINCT participant_id) FILTER (WHERE status='confirmada')::int AS u, count(*)::int AS t FROM registrations`)).rows[0];
    expect(all.totals.confirmed).toBe(truth.c);
    expect(all.totals.uniqueParticipants).toBe(truth.u);
    expect(all.totals.totalRegistrations).toBe(truth.t);
    expect(all.totals.uniqueParticipants).toBeLessThan(all.totals.confirmed);
    const sumByEvent = all.byEvent.reduce((a: number, e: { confirmed: number }) => a + e.confirmed, 0);
    expect(sumByEvent).toBe(all.totals.confirmed);
    const sumBySchool = all.bySchool.reduce((a: number, e: { confirmed: number }) => a + e.confirmed, 0);
    expect(sumBySchool).toBe(all.totals.confirmed);
    const present = (await db().query(`SELECT count(DISTINCT registration_id)::int AS n FROM attendances WHERE revoked_at IS NULL`)).rows[0].n;
    expect(all.totals.present).toBe(present);
  });

  it('exporta CSV, XLSX e PDF; versão resumida sem dados pessoais; exportação auditada', async () => {
    const ev = await newEvent({ title: 'Exportação' });
    await register(ev, 950);
    const csv = await admin.inject('POST', '/api/admin/reports/export', { kind: 'inscritos', format: 'csv', filters: { eventId: ev } });
    expect(csv.status).toBe(200);
    expect(csv.body).toContain(registration(950).fullName);
    expect(csv.body).not.toContain('prof950@teste.local');
    const det = await admin.inject('POST', '/api/admin/reports/export', { kind: 'inscritos', format: 'csv', detailed: true, fields: ['nome', 'cpf', 'email'], filters: { eventId: ev } });
    expect(det.body).toContain('prof950@teste.local');
    expect(det.body.replace(/\D/g, '')).toContain(registration(950).cpf);
    const xlsx = await admin.inject('POST', '/api/admin/reports/export', { kind: 'resumo', format: 'xlsx' });
    expect(xlsx.raw.subarray(0, 2).toString()).toBe('PK');
    const pdf = await admin.inject('POST', '/api/admin/reports/export', { kind: 'presencas', format: 'pdf', signature: true });
    expect(pdf.raw.subarray(0, 4).toString()).toBe('%PDF');
    const logs = (await db().query(`SELECT action FROM audit_logs WHERE action LIKE 'relatorio.%'`)).rows.map((r) => r.action);
    expect(logs).toContain('relatorio.exportar_dados_pessoais');
    expect(logs).toContain('relatorio.exportar');
  });
});

describe('Cenário 12: persistência após sair da conta e reiniciar o servidor', () => {
  it('dados continuam disponíveis após logout e nova instância da aplicação', async () => {
    const ev = await newEvent({ title: 'Persistência' });
    const r = await register(ev, 990);
    const c = await loginAs(app, 'coord@teste.local');
    expect((await c.inject('POST', '/api/auth/logout')).status).toBe(200);
    expect((await c.inject('GET', '/api/admin/events')).status).toBe(401);
    await app.close();
    app = await makeApp();
    admin = await loginAs(app, 'admin@teste.local');
    pub = anon(app);
    const page = await pub.inject('GET', `/api/public/registrations/${r.json.token}`);
    expect(page.json.protocol).toBe(r.json.protocol);
    const list = await admin.inject('GET', `/api/admin/events/${ev}/registrations`);
    expect(list.json).toHaveLength(1);
  });
});
