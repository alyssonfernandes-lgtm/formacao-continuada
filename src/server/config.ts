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
  // 64 caracteres hexadecimais (openssl rand -hex 32) ou qualquer segredo aleatório com 32+ caracteres (ex.: botão "Generate" do Render)
  DATA_ENCRYPTION_KEY: z.string().min(32, 'DATA_ENCRYPTION_KEY deve ter pelo menos 32 caracteres aleatórios'),
  CPF_HMAC_KEY: z.string().min(32, 'CPF_HMAC_KEY deve ter pelo menos 32 caracteres aleatórios'),
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
  // Primeiro administrador, criado só se ainda não houver nenhum usuário (útil em hospedagens sem terminal)
  INITIAL_ADMIN_NAME: z.string().optional(),
  INITIAL_ADMIN_EMAIL: z.preprocess((v) => (v === '' ? undefined : v), z.string().email().optional()),
  INITIAL_ADMIN_PASSWORD: z.string().optional(),
  // true: redefine a senha do administrador INITIAL_ADMIN_EMAIL para INITIAL_ADMIN_PASSWORD (recuperação sem e-mail)
  ADMIN_PASSWORD_RESET: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
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
