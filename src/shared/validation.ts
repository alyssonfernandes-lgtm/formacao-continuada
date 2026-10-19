import { z } from 'zod';

/** Remove tudo que não for dígito. */
export const onlyDigits = (v: string) => v.replace(/\D/g, '');

/**
 * Valida formato e dígitos verificadores do CPF.
 * Atenção: a validação matemática não comprova identidade.
 */
export function isValidCpf(input: string): boolean {
  const cpf = onlyDigits(input);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

export function formatCpf(input: string) {
  const d = onlyDigits(input).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
}

/** Máscara de exibição: ***.456.789-** */
export function maskCpf(input: string) {
  const d = onlyDigits(input);
  if (d.length !== 11) return '***.***.***-**';
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}

/** Telefone brasileiro: DDD + 8 ou 9 dígitos. */
export function isValidPhone(input: string) {
  const d = onlyDigits(input);
  if (d.length !== 10 && d.length !== 11) return false;
  if (d[0] === '0' || d[1] === '0') return false;
  if (d.length === 11 && d[2] !== '9') return false;
  return true;
}

export function formatPhone(input: string) {
  const d = onlyDigits(input).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

const nameRe = /^[\p{L}][\p{L}'´`^~.\- ]+$/u;

export const registrationSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .transform((v) => v.replace(/\s+/g, ' '))
      .pipe(
        z
          .string()
          .min(5, 'Informe o nome completo.')
          .max(200, 'Nome muito longo.')
          .regex(nameRe, 'O nome deve conter apenas letras, espaços, apóstrofo ou hífen.')
          .refine((v) => v.split(' ').filter(Boolean).length >= 2, 'Informe nome e sobrenome.'),
      ),
    cpf: z
      .string()
      .transform(onlyDigits)
      .refine((v) => v.length === 11, 'O CPF deve ter 11 dígitos.')
      .refine(isValidCpf, 'CPF inválido: confira os dígitos.'),
    schoolId: z.string().uuid().nullable().optional(),
    schoolOther: z.string().trim().max(200).nullable().optional(),
    email: z.string().trim().toLowerCase().max(254).email('Informe um e-mail válido.'),
    phone: z
      .string()
      .transform(onlyDigits)
      .refine(isValidPhone, 'Informe o telefone com DDD, por exemplo (48) 99999-9999.'),
    privacyAck: z.literal(true, { errorMap: () => ({ message: 'É necessário declarar ciência do aviso de privacidade.' }) }),
  })
  .refine((v) => Boolean(v.schoolId) || (v.schoolOther && v.schoolOther.length >= 2), {
    message: 'Selecione a escola ou informe a instituição.',
    path: ['schoolId'],
  });

export type RegistrationInput = z.input<typeof registrationSchema>;

export const passwordSchema = z
  .string()
  .min(12, 'A senha deve ter pelo menos 12 caracteres.')
  .max(200)
  .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), 'A senha deve conter letras e números.');
