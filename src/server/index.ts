import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { closePool, getPool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { startEmailWorker, stopEmailWorker } from './services/email-queue.js';
import { runMaintenance } from './services/maintenance.js';
import { seedDefaultLogo, seedDefaultSchools } from './services/settings.js';
import { hashPassword } from './services/auth.js';
import { audit } from './lib/audit.js';
import argon2 from 'argon2';
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
    else if (cfg.ADMIN_PASSWORD_RESET) await resetAdminPassword(cfg.INITIAL_ADMIN_EMAIL, cfg.INITIAL_ADMIN_PASSWORD);
  }
}

/** Recuperação de acesso sem e-mail: só age se a senha atual for diferente da informada (não repete a cada reinício). */
async function resetAdminPassword(email: string, password: string) {
  const { rows } = await getPool().query(`SELECT id, password_hash FROM users WHERE email = lower($1) AND role = 'admin'`, [email]);
  if (!rows[0]) return app.log.error('ADMIN_PASSWORD_RESET: administrador não encontrado para INITIAL_ADMIN_EMAIL');
  if (await argon2.verify(rows[0].password_hash, password).catch(() => false)) return;
  await getPool().query(
    `UPDATE users SET password_hash = $2, active = true, failed_logins = 0, locked_until = NULL, password_changed_at = now() WHERE id = $1`,
    [rows[0].id, await hashPassword(password)],
  );
  await getPool().query(`DELETE FROM user_sessions WHERE user_id = $1`, [rows[0].id]);
  await audit(getPool(), { userId: null, action: 'usuario.senha_redefinida_pela_hospedagem', entityType: 'user', entityId: rows[0].id });
  app.log.warn('senha do administrador redefinida por ADMIN_PASSWORD_RESET; remova a variável');
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
