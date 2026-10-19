import type { Db } from '../db/pool.js';

/** Registra operação administrativa. Nunca inclua CPF, telefone ou tokens em `details`. */
export async function audit(
  db: Db,
  e: { userId: string | null; action: string; entityType?: string; entityId?: string; details?: Record<string, unknown>; ip?: string | null },
) {
  await db.query(
    `INSERT INTO audit_logs(user_id, action, entity_type, entity_id, details, ip) VALUES ($1, $2, $3, $4, $5, $6)`,
    [e.userId, e.action, e.entityType ?? null, e.entityId ?? null, e.details ?? {}, e.ip ?? null],
  );
}
