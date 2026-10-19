// Uso: npm run create-admin -- "Nome" email@dominio senha-forte
import { getPool, closePool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { hashPassword } from '../services/auth.js';
import { passwordSchema } from '../../shared/validation.js';

const [name, email, password] = process.argv.slice(2);
if (!name || !email || !password) {
  console.error('Uso: npm run create-admin -- "Nome completo" email@dominio "senha com 12+ caracteres"');
  process.exit(1);
}
const pw = passwordSchema.safeParse(password);
if (!pw.success) {
  console.error(pw.error.issues[0].message);
  process.exit(1);
}
await migrate(getPool());
await getPool().query(
  `INSERT INTO users(name, email, role, password_hash) VALUES ($1, lower($2), 'admin', $3)
   ON CONFLICT (email) DO UPDATE SET role = 'admin', active = true, password_hash = EXCLUDED.password_hash, password_changed_at = now()`,
  [name, email, await hashPassword(password)],
);
console.log(`Administrador ${email} pronto.`);
await closePool();
