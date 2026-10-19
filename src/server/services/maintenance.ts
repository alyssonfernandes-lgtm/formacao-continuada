import { getPool } from '../db/pool.js';
import { getSettings } from './settings.js';

/** Rotina diária de retenção e descarte (prazos configuráveis no painel). */
export async function runMaintenance() {
  const db = getPool();
  const s = await getSettings();
  const out: Record<string, number> = {};
  out.sessoes = (await db.query(`DELETE FROM user_sessions WHERE expires_at < now() OR last_seen_at < now() - interval '2 days'`)).rowCount ?? 0;
  out.redefinicoes = (await db.query(`DELETE FROM password_resets WHERE expires_at < now() - interval '1 day'`)).rowCount ?? 0;
  out.emails = (
    await db.query(`DELETE FROM email_messages WHERE status IN ('enviado', 'falhou') AND created_at < now() - ($1 || ' days')::interval`, [String(s.retentionEmailDays)])
  ).rowCount ?? 0;
  // Inscrições canceladas sem presença nem certificado: descartadas após o prazo
  out.inscricoes_canceladas = (
    await db.query(
      `DELETE FROM registrations r WHERE r.status = 'cancelada' AND r.cancelled_at < now() - ($1 || ' days')::interval
         AND NOT EXISTS (SELECT 1 FROM attendances a WHERE a.registration_id = r.id)
         AND NOT EXISTS (SELECT 1 FROM certificates c WHERE c.registration_id = r.id)`,
      [String(s.retentionCancelledDays)],
    )
  ).rowCount ?? 0;
  out.participantes_sem_inscricao = (await db.query(`DELETE FROM participants p WHERE NOT EXISTS (SELECT 1 FROM registrations r WHERE r.participant_id = p.id)`)).rowCount ?? 0;
  return out;
}
