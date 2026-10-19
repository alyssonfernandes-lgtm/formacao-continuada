import argon2 from 'argon2';
import { getPool, type Db } from '../db/pool.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { loadConfig } from '../config.js';
import type { Role } from '../../shared/types.js';

export const SESSION_COOKIE = 'fc_sess';
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  csrfToken: string;
  sessionId: Buffer;
}

export const hashPassword = (pw: string) => argon2.hash(pw, { type: argon2.argon2id });

// Hash fixo usado para equalizar o tempo de resposta quando o e-mail não existe
let dummyHash: string | null = null;
async function getDummyHash() {
  if (!dummyHash) dummyHash = await hashPassword(randomToken());
  return dummyHash;
}

export type LoginResult =
  | { ok: true; token: string; user: SessionUser }
  | { ok: false; reason: 'invalid' | 'locked'; lockedUntil?: Date };

export async function login(email: string, password: string, meta: { ip?: string; userAgent?: string }): Promise<LoginResult> {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT id, name, email, role, password_hash, active, failed_logins, locked_until FROM users WHERE email = $1`,
    [email.trim().toLowerCase()],
  );
  const u = rows[0];
  if (!u || !u.active) {
    await argon2.verify(await getDummyHash(), password).catch(() => false);
    return { ok: false, reason: 'invalid' };
  }
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    return { ok: false, reason: 'locked', lockedUntil: u.locked_until };
  }
  const valid = await argon2.verify(u.password_hash, password).catch(() => false);
  if (!valid) {
    const r = await db.query(
      `UPDATE users SET failed_logins = failed_logins + 1,
         locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + ($3 || ' minutes')::interval ELSE locked_until END
       WHERE id = $1 RETURNING failed_logins, locked_until`,
      [u.id, MAX_FAILED_LOGINS, String(LOCK_MINUTES)],
    );
    if (r.rows[0].failed_logins >= MAX_FAILED_LOGINS) return { ok: false, reason: 'locked', lockedUntil: r.rows[0].locked_until };
    return { ok: false, reason: 'invalid' };
  }
  await db.query(`UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [u.id]);
  const { token, csrf, sessionId } = await createSession(db, u.id, meta);
  return { ok: true, token, user: { id: u.id, name: u.name, email: u.email, role: u.role, csrfToken: csrf, sessionId } };
}

export async function createSession(db: Db, userId: string, meta: { ip?: string; userAgent?: string }) {
  const token = randomToken();
  const csrf = randomToken();
  const sessionId = sha256(token);
  const ttl = loadConfig().SESSION_TTL_HOURS;
  await db.query(
    `INSERT INTO user_sessions(id, user_id, csrf_token, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, now() + ($4 || ' hours')::interval, $5, $6)`,
    [sessionId, userId, csrf, String(ttl), meta.ip ?? null, (meta.userAgent ?? '').slice(0, 300)],
  );
  return { token, csrf, sessionId };
}

export async function resolveSession(token: string): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null;
  const idle = loadConfig().SESSION_IDLE_MINUTES;
  const sessionId = sha256(token);
  const { rows } = await getPool().query(
    `UPDATE user_sessions s SET last_seen_at = now()
       FROM users u
      WHERE s.id = $1 AND u.id = s.user_id AND u.active
        AND s.expires_at > now() AND s.last_seen_at > now() - ($2 || ' minutes')::interval
        AND s.created_at >= u.password_changed_at
     RETURNING u.id, u.name, u.email, u.role, s.csrf_token`,
    [sessionId, String(idle)],
  );
  const r = rows[0];
  if (!r) return null;
  return { id: r.id, name: r.name, email: r.email, role: r.role, csrfToken: r.csrf_token, sessionId };
}

export async function destroySession(sessionId: Buffer) {
  await getPool().query(`DELETE FROM user_sessions WHERE id = $1`, [sessionId]);
}

/** Cria token de redefinição (1 hora, uso único). Retorna null se o e-mail não existir. */
export async function createPasswordReset(db: Db, email: string) {
  const { rows } = await db.query(`SELECT id, name, email FROM users WHERE email = $1 AND active`, [email.trim().toLowerCase()]);
  if (!rows[0]) return null;
  const token = randomToken();
  await db.query(`UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [rows[0].id]);
  await db.query(`INSERT INTO password_resets(token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')`, [sha256(token), rows[0].id]);
  return { token, user: rows[0] as { id: string; name: string; email: string } };
}

export async function consumePasswordReset(db: Db, token: string, newPassword: string) {
  const { rows } = await db.query(
    `UPDATE password_resets SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
    [sha256(token)],
  );
  if (!rows[0]) return null;
  const hash = await hashPassword(newPassword);
  // Alterar a senha encerra todas as sessões abertas (password_changed_at)
  await db.query(
    `UPDATE users SET password_hash = $2, password_changed_at = now(), failed_logins = 0, locked_until = NULL WHERE id = $1`,
    [rows[0].user_id, hash],
  );
  await db.query(`DELETE FROM user_sessions WHERE user_id = $1`, [rows[0].user_id]);
  return rows[0].user_id as string;
}
