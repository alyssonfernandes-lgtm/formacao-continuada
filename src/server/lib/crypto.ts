import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { loadConfig } from '../config.js';

const key = () => Buffer.from(loadConfig().DATA_ENCRYPTION_KEY, 'hex');

/** AES-256-GCM: [12 bytes IV][16 bytes tag][dados]. */
export function encrypt(plain: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]);
}

export function decrypt(buf: Buffer): string {
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

/** Índice cego do CPF: permite unicidade e busca sem guardar o CPF em claro. */
export function cpfBlindIndex(cpfDigits: string): Buffer {
  return createHmac('sha256', Buffer.from(loadConfig().CPF_HMAC_KEY, 'hex')).update(cpfDigits).digest();
}

export const sha256 = (v: string) => createHash('sha256').update(v).digest();

/** Token aleatório de 256 bits em base64url (43 caracteres). */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

const B32 = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sem I, L, O, 0, 1 para evitar confusão na leitura
export function randomCode(len: number) {
  let out = '';
  while (out.length < len) {
    for (const b of randomBytes(len * 2)) {
      if (b < 248) out += B32[b % B32.length]; // 248 = 31 * 8: sem viés
      if (out.length === len) break;
    }
  }
  return out;
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
