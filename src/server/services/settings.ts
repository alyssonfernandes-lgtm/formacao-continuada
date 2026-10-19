import { z } from 'zod';
import { getPool, type Db } from '../db/pool.js';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor no formato #RRGGBB');

export const settingsSchema = z.object({
  platformName: z.string().min(3).max(120),
  municipality: z.string().max(120),
  department: z.string().max(200),
  primaryColor: hex,
  secondaryColor: hex,
  contactEmail: z.string().max(254),
  contactPhone: z.string().max(40),
  contactAddress: z.string().max(300),
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat('pt-BR', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Fuso horário inválido'),
  controllerName: z.string().max(300),
  dpoName: z.string().max(200),
  dpoContact: z.string().max(300),
  privacyExtra: z.string().max(10000),
  retentionCancelledDays: z.coerce.number().int().min(30).max(3650),
  retentionEmailDays: z.coerce.number().int().min(30).max(3650),
  checkinBeforeMinutes: z.coerce.number().int().min(0).max(1440),
  checkinAfterMinutes: z.coerce.number().int().min(0).max(1440),
  defaultSignerName: z.string().trim().max(200).default(''),
  defaultSignerRole: z.string().trim().max(200).default(''),
});

export type Settings = z.infer<typeof settingsSchema> & { hasLogo: boolean; logoVersion: string | null };

export const DEFAULT_SETTINGS: z.infer<typeof settingsSchema> = {
  platformName: 'Formação Continuada — Educação Municipal',
  municipality: 'Balneário Rincão',
  department: 'Secretaria Municipal de Educação',
  primaryColor: '#0b3f86',
  secondaryColor: '#0f766e',
  contactEmail: 'educacao@balneariorincao.sc.gov.br',
  contactPhone: '(48) 3468-7245',
  contactAddress: 'Rua Urubici, 989 — Balneário Rincão/SC · Atendimento: segunda a sexta, 8h às 12h e 13h às 17h',
  timezone: 'America/Sao_Paulo',
  controllerName: 'Prefeitura Municipal de Balneário Rincão, por meio da Secretaria Municipal de Educação',
  dpoName: '',
  dpoContact: '',
  privacyExtra: '',
  retentionCancelledDays: 365,
  retentionEmailDays: 180,
  checkinBeforeMinutes: 120,
  checkinAfterMinutes: 120,
  defaultSignerName: 'Professora Jucilene Antonio Fernandes',
  defaultSignerRole: 'Secretária Municipal de Educação',
};

let cache: { at: number; value: Settings } | null = null;

export function invalidateSettingsCache() {
  cache = null;
}

export async function getSettings(db: Db = getPool()): Promise<Settings> {
  if (cache && Date.now() - cache.at < 10_000) return cache.value;
  const { rows } = await db.query<{ key: string; value: unknown; updated_at: Date }>(
    `SELECT key, value, updated_at FROM settings WHERE key IN ('institution', 'logo')`,
  );
  const inst = rows.find((r) => r.key === 'institution');
  const logo = rows.find((r) => r.key === 'logo');
  const merged = { ...DEFAULT_SETTINGS, ...((inst?.value as object) ?? {}) };
  const value: Settings = {
    ...merged,
    hasLogo: Boolean(logo),
    logoVersion: logo ? String(logo.updated_at.getTime()) : null,
  };
  cache = { at: Date.now(), value };
  return value;
}

export async function saveSettings(db: Db, input: unknown, userId: string) {
  const parsed = settingsSchema.parse(input);
  await db.query(
    `INSERT INTO settings(key, value, updated_by) VALUES ('institution', $1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [parsed, userId],
  );
  invalidateSettingsCache();
  return parsed;
}

export async function getLogo(db: Db = getPool()): Promise<{ mime: string; data: Buffer } | null> {
  const { rows } = await db.query<{ value: { mime: string; data: string } }>(`SELECT value FROM settings WHERE key = 'logo'`);
  if (!rows[0]) return null;
  return { mime: rows[0].value.mime, data: Buffer.from(rows[0].value.data, 'base64') };
}

export async function saveLogo(db: Db, mime: string, data: Buffer, userId: string) {
  await db.query(
    `INSERT INTO settings(key, value, updated_by) VALUES ('logo', $1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [{ mime, data: data.toString('base64') }, userId],
  );
  invalidateSettingsCache();
}

export async function deleteLogo(db: Db) {
  await db.query(`DELETE FROM settings WHERE key = 'logo'`);
  invalidateSettingsCache();
}

/**
 * Na primeira inicialização, carrega o logotipo oficial enviado pela Secretaria (src/server/assets/logo-padrao.png).
 * Roda uma única vez: se a administração remover ou trocar o logotipo depois, ele não volta.
 */
export async function seedDefaultLogo(db: Db, file: string) {
  const { rowCount } = await db.query(`INSERT INTO settings(key, value) VALUES ('logo_seeded', 'true') ON CONFLICT (key) DO NOTHING`);
  if (!rowCount) return false;
  const { readFile } = await import('node:fs/promises');
  const data = await readFile(file).catch(() => null);
  if (!data) return false;
  await db.query(`INSERT INTO settings(key, value) VALUES ('logo', $1) ON CONFLICT (key) DO NOTHING`, [{ mime: 'image/png', data: data.toString('base64') }]);
  invalidateSettingsCache();
  return true;
}

/** Na primeira inicialização, cadastra as unidades da rede municipal (src/server/assets/escolas.json), só se não houver escolas. */
export async function seedDefaultSchools(db: Db, file: string) {
  const { rowCount } = await db.query(`INSERT INTO settings(key, value) VALUES ('schools_seeded', 'true') ON CONFLICT (key) DO NOTHING`);
  if (!rowCount) return 0;
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(file, 'utf8').catch(() => null);
  if (!raw) return 0;
  const { escolas } = JSON.parse(raw) as { escolas: { name: string; unit: string }[] };
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM schools`);
  if (rows[0].n > 0) return 0;
  for (const e of escolas) await db.query(`INSERT INTO schools(name, unit) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`, [e.name, e.unit]);
  return escolas.length;
}
