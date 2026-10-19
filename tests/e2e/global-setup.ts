import pg from 'pg';
import argon2 from 'argon2';
import { E2E_ENV } from '../../playwright.config';

export default async function globalSetup() {
  const db = new pg.Client({ connectionString: E2E_ENV.DATABASE_URL });
  await db.connect();
  // O servidor aplica as migrações ao iniciar; aqui apenas limpamos os dados entre execuções
  const tables = await db.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`);
  if (tables.rows.length) await db.query(`TRUNCATE ${tables.rows.map((r) => r.tablename).join(', ')} RESTART IDENTITY CASCADE`);
  const hash = await argon2.hash('SenhaForte12345', { type: argon2.argon2id });
  for (const [name, email, role] of [
    ['Ana Administradora', 'admin@e2e.local', 'admin'],
    ['Carla Coordenadora', 'coord@e2e.local', 'coordenacao'],
    ['Otávio Operador', 'cred@e2e.local', 'credenciamento'],
    ['Gustavo Gestor', 'consulta@e2e.local', 'consulta'],
  ]) {
    await db.query(`INSERT INTO users(name, email, role, password_hash) VALUES ($1, $2, $3, $4)`, [name, email, role, hash]);
  }
  await db.end();
}
