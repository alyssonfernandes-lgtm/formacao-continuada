import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  // Chaves de 32 bytes em hexadecimal (64 caracteres). Gere com: openssl rand -hex 32
  DATA_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'DATA_ENCRYPTION_KEY deve ter 64 caracteres hexadecimais'),
  CPF_HMAC_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'CPF_HMAC_KEY deve ter 64 caracteres hexadecimais'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(8),
  SESSION_IDLE_MINUTES: z.coerce.number().positive().default(60),
  TRUST_PROXY: bool,
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  SMTP_REQUIRE_TLS: bool,
  WORKER_INLINE: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(5000),
  LOG_LEVEL: z.string().default('info'),
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (cached) return cached;
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msgs = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida:\n${msgs}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetConfigForTests() {
  cached = null;
}

export function smtpConfigured(c: Config) {
  return Boolean(c.SMTP_HOST && c.SMTP_FROM);
}
