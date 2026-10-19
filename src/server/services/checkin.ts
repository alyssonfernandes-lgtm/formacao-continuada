import { getPool, tx } from '../db/pool.js';
import { sha256 } from '../lib/crypto.js';
import { audit } from '../lib/audit.js';
import { AppError, notFound } from '../lib/errors.js';
import { can, type CheckinResult } from '../../shared/types.js';
import type { SessionUser } from './auth.js';
import { getSettings } from './settings.js';
import { extractToken } from './registrations.js';

export interface CheckinResponse {
  result: CheckinResult;
  message: string;
  participant?: { name: string; school: string; protocol: string };
  checkedInAt?: string;
  checkedInBy?: string;
  otherEvent?: string;
}

const MSG: Record<CheckinResult, string> = {
  registrado: 'Presença registrada com sucesso.',
  ja_registrado: 'Participante já registrado nesta sessão.',
  qr_invalido: 'QR Code inválido: não é um código de inscrição desta plataforma.',
  inscricao_cancelada: 'Inscrição cancelada: presença não registrada.',
  nao_localizada: 'Inscrição não localizada. O código pode ter sido substituído.',
  outro_evento: 'Este QR Code pertence a outro evento.',
  evento_nao_autorizado: 'Você não está autorizado a credenciar este evento.',
  fora_da_janela: 'Fora do horário de credenciamento desta sessão.',
};

export async function canOperateEvent(user: SessionUser, eventId: string) {
  if (can(user.role, 'checkin.any')) return true;
  if (!can(user.role, 'checkin.assigned')) return false;
  const r = await getPool().query(`SELECT 1 FROM event_staff WHERE event_id = $1 AND user_id = $2`, [eventId, user.id]);
  return Boolean(r.rowCount);
}

async function sessionContext(eventId: string, sessionId: string) {
  const { rows } = await getPool().query(
    `SELECT es.id, es.starts_at, es.ends_at, e.status FROM event_sessions es JOIN events e ON e.id = es.event_id WHERE es.id = $1 AND es.event_id = $2`,
    [sessionId, eventId],
  );
  return rows[0] ?? null;
}

export async function checkinWindowOpen(session: { starts_at: Date; ends_at: Date }, now = new Date()) {
  const s = await getSettings();
  const from = new Date(session.starts_at.getTime() - s.checkinBeforeMinutes * 60_000);
  const to = new Date(session.ends_at.getTime() + s.checkinAfterMinutes * 60_000);
  return now >= from && now <= to;
}

function respond(result: CheckinResult, extra: Partial<CheckinResponse> = {}): CheckinResponse {
  return { result, message: MSG[result], ...extra };
}

/**
 * Registra presença. Todas as verificações acontecem no servidor; a unicidade final é garantida pelo índice
 * único parcial (inscrição, sessão), de modo que leituras simultâneas não duplicam o registro.
 */
export async function checkin(
  user: SessionUser,
  p: { eventId: string; sessionId: string; raw?: string; registrationId?: string },
): Promise<CheckinResponse> {
  if (!(await canOperateEvent(user, p.eventId))) return respond('evento_nao_autorizado');
  const sess = await sessionContext(p.eventId, p.sessionId);
  if (!sess || sess.status !== 'publicado') return respond('evento_nao_autorizado');
  if (!(await checkinWindowOpen(sess))) return respond('fora_da_janela');

  let where: string;
  let param: unknown;
  if (p.registrationId) {
    if (!/^[0-9a-f-]{36}$/i.test(p.registrationId)) return respond('nao_localizada');
    where = 'r.id = $1';
    param = p.registrationId;
  } else {
    const token = extractToken(p.raw ?? '');
    if (!token) return respond('qr_invalido');
    where = 'r.qr_token_hash = $1';
    param = sha256(token);
  }
  const { rows } = await getPool().query(
    `SELECT r.id, r.event_id, r.status, r.protocol, p.full_name, coalesce(s.name, r.school_other) AS school, e.title
       FROM registrations r JOIN participants p ON p.id = r.participant_id LEFT JOIN schools s ON s.id = r.school_id
       JOIN events e ON e.id = r.event_id WHERE ${where}`,
    [param],
  );
  const r = rows[0];
  if (!r) return respond('nao_localizada');
  if (r.event_id !== p.eventId) return respond('outro_evento', { otherEvent: r.title });
  const participant = { name: r.full_name, school: r.school, protocol: r.protocol };
  if (r.status !== 'confirmada') return respond('inscricao_cancelada', { participant });

  const ins = await getPool().query(
    `INSERT INTO attendances(registration_id, session_id, checked_in_by, method)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (registration_id, session_id) WHERE revoked_at IS NULL DO NOTHING
     RETURNING checked_in_at`,
    [r.id, p.sessionId, user.id, p.registrationId ? 'manual' : 'qrcode'],
  );
  if (ins.rows[0]) return respond('registrado', { participant, checkedInAt: ins.rows[0].checked_in_at.toISOString() });
  const prev = await getPool().query(
    `SELECT a.checked_in_at, u.name FROM attendances a JOIN users u ON u.id = a.checked_in_by
      WHERE a.registration_id = $1 AND a.session_id = $2 AND a.revoked_at IS NULL`,
    [r.id, p.sessionId],
  );
  return respond('ja_registrado', { participant, checkedInAt: prev.rows[0]?.checked_in_at?.toISOString(), checkedInBy: prev.rows[0]?.name });
}

/** Busca manual no credenciamento: devolve apenas nome, escola e protocolo. */
export async function searchForCheckin(eventId: string, sessionId: string, q: string) {
  const term = q.trim();
  if (term.length < 3) return [];
  const { rows } = await getPool().query(
    `SELECT r.id, r.protocol, r.status, p.full_name, coalesce(s.name, r.school_other) AS school,
            EXISTS (SELECT 1 FROM attendances a WHERE a.registration_id = r.id AND a.session_id = $4 AND a.revoked_at IS NULL) AS present
       FROM registrations r JOIN participants p ON p.id = r.participant_id LEFT JOIN schools s ON s.id = r.school_id
      WHERE r.event_id = $1 AND (r.protocol = $2 OR p.full_name ILIKE $3)
      ORDER BY p.full_name LIMIT 15`,
    [eventId, term.toUpperCase(), `%${term.replace(/[%_\\]/g, '\\$&')}%`, sessionId],
  );
  return rows.map((r) => ({ id: r.id, protocol: r.protocol, status: r.status, name: r.full_name, school: r.school, present: r.present }));
}

export async function sessionStats(sessionId: string) {
  const { rows } = await getPool().query(
    `SELECT (SELECT count(*) FROM attendances a WHERE a.session_id = $1 AND a.revoked_at IS NULL)::int AS present,
            (SELECT count(*) FROM registrations r JOIN event_sessions es ON es.event_id = r.event_id WHERE es.id = $1 AND r.status = 'confirmada')::int AS confirmed`,
    [sessionId],
  );
  return rows[0];
}

/** Correção manual (inclusão fora do fluxo normal), com justificativa obrigatória. */
export async function correctAttendance(user: SessionUser, p: { registrationId: string; sessionId: string; justification: string }, ip?: string) {
  if (p.justification.trim().length < 5) throw new AppError(400, 'justificativa', 'Informe uma justificativa com pelo menos 5 caracteres.');
  return tx(async (c) => {
    const r = await c.query(
      `SELECT r.id FROM registrations r JOIN event_sessions es ON es.event_id = r.event_id WHERE r.id = $1 AND es.id = $2 AND r.status = 'confirmada'`,
      [p.registrationId, p.sessionId],
    );
    if (!r.rowCount) throw notFound('Inscrição confirmada ou sessão não encontrada para este evento.');
    const ins = await c.query(
      `INSERT INTO attendances(registration_id, session_id, checked_in_by, method, justification) VALUES ($1, $2, $3, 'correcao', $4)
       ON CONFLICT (registration_id, session_id) WHERE revoked_at IS NULL DO NOTHING RETURNING id`,
      [p.registrationId, p.sessionId, user.id, p.justification.trim()],
    );
    if (!ins.rows[0]) throw new AppError(409, 'ja_registrado', 'A presença já está registrada nesta sessão.');
    await audit(c, { userId: user.id, action: 'presenca.incluir_correcao', entityType: 'presenca', entityId: ins.rows[0].id, details: { inscricao: p.registrationId, sessao: p.sessionId, justificativa: p.justification.trim() }, ip });
    return ins.rows[0].id as string;
  });
}

export async function revokeAttendance(user: SessionUser, attendanceId: string, reason: string, ip?: string) {
  if (reason.trim().length < 5) throw new AppError(400, 'justificativa', 'Informe uma justificativa com pelo menos 5 caracteres.');
  return tx(async (c) => {
    const r = await c.query(
      `UPDATE attendances SET revoked_at = now(), revoked_by = $2, revoke_reason = $3 WHERE id = $1 AND revoked_at IS NULL RETURNING registration_id, session_id`,
      [attendanceId, user.id, reason.trim()],
    );
    if (!r.rowCount) throw notFound('Presença válida não encontrada.');
    await audit(c, { userId: user.id, action: 'presenca.anular', entityType: 'presenca', entityId: attendanceId, details: { inscricao: r.rows[0].registration_id, sessao: r.rows[0].session_id, justificativa: reason.trim() }, ip });
  });
}

export async function listAttendances(eventId: string) {
  const { rows } = await getPool().query(
    `SELECT a.id, a.registration_id, a.session_id, a.checked_in_at, a.method, a.justification, a.revoked_at, a.revoke_reason,
            u.name AS operator, ru.name AS revoked_by_name, p.full_name, r.protocol, coalesce(s.name, r.school_other) AS school
       FROM attendances a JOIN registrations r ON r.id = a.registration_id JOIN participants p ON p.id = r.participant_id
       LEFT JOIN schools s ON s.id = r.school_id JOIN users u ON u.id = a.checked_in_by LEFT JOIN users ru ON ru.id = a.revoked_by
      WHERE r.event_id = $1 ORDER BY a.checked_in_at DESC`,
    [eventId],
  );
  return rows;
}
