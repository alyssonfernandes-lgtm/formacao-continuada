import { defineConfig } from '@playwright/test';

// Ambiente E2E: servidor compilado (npm run build) + banco formacao_e2e + caixa SMTP local na porta 2527
export const E2E_ENV = {
  NODE_ENV: 'test',
  PORT: '3100',
  PUBLIC_URL: 'http://localhost:3100',
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgres://formacao:formacao_dev@localhost:5432/formacao_e2e',
  DATA_ENCRYPTION_KEY: 'c'.repeat(64),
  CPF_HMAC_KEY: 'd'.repeat(64),
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '2527',
  SMTP_FROM: 'Formacao <nao-responda@teste.local>',
  WORKER_POLL_MS: '1000',
  LOG_LEVEL: 'warn',
};

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  use: { baseURL: 'http://localhost:3100', locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', screenshot: 'only-on-failure' },
  globalSetup: './tests/e2e/global-setup.ts',
  webServer: [
    { command: 'npx tsx src/server/scripts/dev-smtp.ts', env: { DEV_SMTP_PORT: '2527', MAILBOX_DIR: 'test-results/mailbox' }, port: 2527, reuseExistingServer: false },
    { command: 'node dist/server/server/index.js', env: E2E_ENV, url: 'http://localhost:3100/api/health', reuseExistingServer: false, timeout: 60_000 },
  ],
});
