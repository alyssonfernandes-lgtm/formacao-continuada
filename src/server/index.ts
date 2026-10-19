import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { closePool, getPool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { startEmailWorker, stopEmailWorker } from './services/email-queue.js';
import { runMaintenance } from './services/maintenance.js';
import { seedDefaultLogo, seedDefaultSchools } from './services/settings.js';
import { hashPassword } from './services/auth.js';
import { passwordSchema } from '../shared/validation.js';
import { fileURLToPath } from 'node:url';

const cfg = loadConfig();
const app = await buildApp();
await migrate(getPool(), (m) => app.log.info(m));
if (cfg.INITIAL_ADMIN_EMAIL && cfg.INITIAL_ADMIN_PASSWORD) {
  const pw = passwordSchema.safeParse(cfg.INITIAL_ADMIN_PASSWORD);
  if (!pw.success) app.log.error('INITIAL_ADMIN_PASSWORD não atende à política de senha; administrador inicial não criado');
  else {
    const r = await getPool().query(
      `INSERT INTO users(name, email, role, password_hash) SELECT $1, lower($2), 'admin', $3 WHERE NOT EXISTS (SELECT 1 FROM users)`,
      [cfg.INITIAL_ADMIN_NAME || 'Administrador', cfg.INITIAL_ADMIN_EMAIL, await hashPassword(cfg.INITIAL_ADMIN_PASSWORD)],
    );
    if (r.rowCount) app.log.info('administrador inicial criado');
  }
}
const escolas = await seedDefaultSchools(getPool(), fileURLToPath(new URL('./assets/escolas.json', import.meta.url)));
if (escolas) app.log.info(`${escolas} unidades escolares cadastradas`);
if (await seedDefaultLogo(getPool(), fileURLToPath(new URL('./assets/logo-padrao.png', import.meta.url)))) app.log.info('logotipo padrão carregado');

let maint: NodeJS.Timeout | null = null;
if (cfg.WORKER_INLINE) {
  startEmailWorker(app.log);
  const run = () => runMaintenance().then((r) => app.log.info({ descarte: r }, 'rotina de retenção executada')).catch((e) => app.log.error(e, 'falha na rotina de retenção'));
  maint = setInterval(run, 24 * 3600 * 1000);
  setTimeout(run, 60_000);
}

await app.listen({ port: cfg.PORT, host: cfg.HOST });

const shutdown = async () => {
  stopEmailWorker();
  if (maint) clearInterval(maint);
  await app.close();
  await closePool();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
