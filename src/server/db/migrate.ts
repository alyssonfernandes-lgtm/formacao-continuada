import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));

// Em produção os .sql são copiados para dist pelo build; em dev ficam ao lado deste arquivo.
async function migrationsDir() {
  const candidates = [path.join(here, 'migrations'), path.resolve(here, '../../../src/server/db/migrations'), path.resolve(here, '../../../../src/server/db/migrations')];
  for (const c of candidates) {
    try {
      await readdir(c);
      return c;
    } catch {
      /* tenta o próximo */
    }
  }
  throw new Error('Diretório de migrações não encontrado');
}

export async function migrate(pool: pg.Pool, log: (m: string) => void = () => undefined) {
  const client = await pool.connect();
  try {
    // Impede duas instâncias migrando ao mesmo tempo
    await client.query('SELECT pg_advisory_lock(727001)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const dir = await migrationsDir();
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(path.join(dir, f), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
        await client.query('COMMIT');
        log(`migração aplicada: ${f}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Falha na migração ${f}: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727001)').catch(() => undefined);
    client.release();
  }
}
