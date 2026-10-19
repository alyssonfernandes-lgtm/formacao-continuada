import type pg from 'pg';
import { getPool, tx, type Db } from '../db/pool.js';
import { eventSchema } from '../../shared/eventSchema.js';
import type { EventPhase } from '../../shared/types.js';
import { audit } from '../lib/audit.js';
import { AppError, notFound } from '../lib/errors.js';

export interface EventRow {
  id: string;
  title: string;
  description: string;
  objectives: string;
  target_audience: string;
  syllabus: string;
  location: string;
  modality: string;
  instructor: string;
  promoter: string;
  workload_hours: number;
  capacity: number | null;
  registration_opens_at: Date;
  registration_closes_at: Date;
  status: 'rascunho' | 'publicado' | 'concluido' | 'cancelado';
  certificate_info: string;
  cert_criterion: 'todas_sessoes' | 'percentual_minimo';
  cert_min_percent: number;
  cert_hours_mode: 'integral' | 'proporcional';
  cert_signer_name: string;
  cert_signer_role: string;
  certificates_released_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface SessionRow {
  id: string;
  event_id: string;
  title: string;
  starts_at: Date;
  ends_at: Date;
  hours: number;
}

export function computePhase(e: Pick<EventRow, 'status' | 'registration_opens_at' | 'registration_closes_at'>, firstStart: Date | null, lastEnd: Date | null, now = new Date()): EventPhase {
  if (e.status !== 'publicado') return e.status;
  if (lastEnd && now > lastEnd) return 'concluido';
  if (firstStart && now >= firstStart) return 'em_andamento';
  if (now < e.registration_opens_at) return 'publicado';
  if (now <= e.registration_closes_at) return 'inscricoes_abertas';
  return 'inscricoes_encerradas';
}

/** Inscrições abertas: evento publicado, dentro do prazo definido e ainda não encerrado. */
export function isRegistrationWindow(e: Pick<EventRow, 'status' | 'registration_opens_at' | 'registration_closes_at'>, lastEnd: Date | null, now = new Date()) {
  return e.status === 'publicado' && now >= e.registration_opens_at && now <= e.registration_closes_at && !(lastEnd && now > lastEnd);
}

export function toEventDto(e: EventRow, sessions: SessionRow[], confirmed: number) {
  const sorted = [...sessions].sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime());
  const firstStart = sorted[0]?.starts_at ?? null;
  const lastEnd = sorted.length ? new Date(Math.max(...sorted.map((s) => s.ends_at.getTime()))) : null;
  const phase = computePhase(e, firstStart, lastEnd);
  const full = e.capacity !== null && confirmed >= e.capacity;
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    objectives: e.objectives,
    targetAudience: e.target_audience,
    syllabus: e.syllabus,
    location: e.location,
    modality: e.modality,
    instructor: e.instructor,
    promoter: e.promoter,
    workloadHours: e.workload_hours,
    capacity: e.capacity,
    registrationOpensAt: e.registration_opens_at,
    registrationClosesAt: e.registration_closes_at,
    status: e.status,
    phase,
    full,
    spotsLeft: e.capacity === null ? null : Math.max(0, e.capacity - confirmed),
    registrationOpen: isRegistrationWindow(e, lastEnd) && !full,
    certificateInfo: e.certificate_info,
    certCriterion: e.cert_criterion,
    certMinPercent: e.cert_min_percent,
    certHoursMode: e.cert_hours_mode,
    certSignerName: e.cert_signer_name,
    certSignerRole: e.cert_signer_role,
    certificatesReleasedAt: e.certificates_released_at,
    startsAt: firstStart,
    endsAt: lastEnd,
    sessions: sorted.map((s) => ({ id: s.id, title: s.title, startsAt: s.starts_at, endsAt: s.ends_at, hours: s.hours })),
  };
}

export type EventDto = ReturnType<typeof toEventDto>;

async function loadMany(db: Db, where: string, params: unknown[]): Promise<EventDto[]> {
  const { rows } = await db.query<EventRow & { confirmed: number }>(
    `SELECT e.*, (SELECT count(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'confirmada')::int AS confirmed
       FROM events e ${where}`,
    params,
  );
  if (!rows.length) return [];
  const sess = await db.query<SessionRow>(`SELECT * FROM event_sessions WHERE event_id = ANY($1) ORDER BY starts_at`, [rows.map((r) => r.id)]);
  return rows.map((r) => toEventDto(r, sess.rows.filter((s) => s.event_id === r.id), r.confirmed));
}

export async function getEvent(id: string, db: Db = getPool()) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [e] = await loadMany(db, 'WHERE e.id = $1', [id]);
  return e ?? null;
}

export async function listPublicEvents() {
  const all = await loadMany(getPool(), `WHERE e.status = 'publicado'`, []);
  return all
    .filter((e) => e.phase !== 'concluido')
    .sort((a, b) => (a.startsAt?.getTime() ?? 0) - (b.startsAt?.getTime() ?? 0));
}

export async function listAdminEvents(filter: { userId?: string } = {}) {
  const evs = filter.userId
    ? await loadMany(getPool(), `WHERE e.id IN (SELECT event_id FROM event_staff WHERE user_id = $1) AND e.status <> 'rascunho'`, [filter.userId])
    : await loadMany(getPool(), '', []);
  return evs.sort((a, b) => (b.startsAt?.getTime() ?? 0) - (a.startsAt?.getTime() ?? 0));
}

async function writeSessions(c: pg.PoolClient, eventId: string, sessions: ReturnType<typeof eventSchema.parse>['sessions']) {
  const existing = await c.query<{ id: string }>(`SELECT id FROM event_sessions WHERE event_id = $1`, [eventId]);
  const keep = new Set(sessions.filter((s) => s.id).map((s) => s.id));
  for (const { id } of existing.rows) {
    if (!keep.has(id)) {
      const used = await c.query(`SELECT 1 FROM attendances WHERE session_id = $1 LIMIT 1`, [id]);
      if (used.rowCount) throw new AppError(409, 'sessao_com_presencas', 'Não é possível remover uma sessão que já possui presenças registradas.');
      await c.query(`DELETE FROM event_sessions WHERE id = $1`, [id]);
    }
  }
  for (const s of sessions) {
    if (s.id && existing.rows.some((r) => r.id === s.id)) {
      await c.query(`UPDATE event_sessions SET title = $2, starts_at = $3, ends_at = $4, hours = $5 WHERE id = $1 AND event_id = $6`, [
        s.id, s.title, s.startsAt, s.endsAt, s.hours, eventId,
      ]);
    } else {
      await c.query(`INSERT INTO event_sessions(event_id, title, starts_at, ends_at, hours) VALUES ($1, $2, $3, $4, $5)`, [
        eventId, s.title, s.startsAt, s.endsAt, s.hours,
      ]);
    }
  }
}

const COLS = `title, description, objectives, target_audience, syllabus, location, modality, instructor, promoter,
  workload_hours, capacity, registration_opens_at, registration_closes_at, status, certificate_info,
  cert_criterion, cert_min_percent, cert_hours_mode, cert_signer_name, cert_signer_role`;

function values(v: ReturnType<typeof eventSchema.parse>) {
  return [
    v.title, v.description, v.objectives, v.targetAudience, v.syllabus, v.location, v.modality, v.instructor, v.promoter,
    v.workloadHours, v.capacity, v.registrationOpensAt, v.registrationClosesAt, v.status, v.certificateInfo,
    v.certCriterion, v.certMinPercent, v.certHoursMode, v.certSignerName, v.certSignerRole,
  ];
}

export async function createEvent(input: unknown, userId: string, ip?: string) {
  const v = eventSchema.parse(input);
  return tx(async (c) => {
    const ph = values(v).map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await c.query(`INSERT INTO events(${COLS}, created_by) VALUES (${ph}, $21) RETURNING id`, [...values(v), userId]);
    await writeSessions(c, rows[0].id, v.sessions);
    await audit(c, { userId, action: 'evento.criar', entityType: 'evento', entityId: rows[0].id, details: { titulo: v.title, status: v.status }, ip });
    return rows[0].id as string;
  });
}

export async function updateEvent(id: string, input: unknown, userId: string, ip?: string) {
  const v = eventSchema.parse(input);
  return tx(async (c) => {
    const before = await c.query<EventRow>(`SELECT * FROM events WHERE id = $1 FOR UPDATE`, [id]);
    if (!before.rows[0]) throw notFound('Evento não encontrado.');
    const b = before.rows[0];
    if (v.capacity !== null) {
      const { rows } = await c.query(`SELECT count(*)::int AS n FROM registrations WHERE event_id = $1 AND status = 'confirmada'`, [id]);
      if (rows[0].n > v.capacity) throw new AppError(409, 'capacidade_menor', `Já existem ${rows[0].n} inscrições confirmadas; o limite não pode ser menor que isso.`);
    }
    const sets = COLS.split(',').map((col, i) => `${col.trim()} = $${i + 2}`).join(', ');
    await c.query(`UPDATE events SET ${sets}, updated_at = now() WHERE id = $1`, [id, ...values(v)]);
    await writeSessions(c, id, v.sessions);
    // Auditoria: apenas os nomes dos campos alterados e o status, sem conteúdo extenso
    const changed: string[] = [];
    const map: Record<string, unknown> = {
      title: v.title, location: v.location, workload_hours: v.workloadHours, capacity: v.capacity, status: v.status,
      cert_criterion: v.certCriterion, cert_min_percent: v.certMinPercent, cert_hours_mode: v.certHoursMode,
    };
    for (const [k, val] of Object.entries(map)) if (String((b as unknown as Record<string, unknown>)[k]) !== String(val)) changed.push(k);
    await audit(c, { userId, action: 'evento.alterar', entityType: 'evento', entityId: id, details: { campos: changed, status_anterior: b.status, status: v.status }, ip });
  });
}

export async function setStaff(eventId: string, userIds: string[], actor: string, ip?: string) {
  await tx(async (c) => {
    await c.query(`DELETE FROM event_staff WHERE event_id = $1`, [eventId]);
    for (const u of userIds) await c.query(`INSERT INTO event_staff(event_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [eventId, u]);
    await audit(c, { userId: actor, action: 'evento.equipe', entityType: 'evento', entityId: eventId, details: { usuarios: userIds.length }, ip });
  });
}

export async function getStaff(eventId: string) {
  const { rows } = await getPool().query(`SELECT user_id FROM event_staff WHERE event_id = $1`, [eventId]);
  return rows.map((r) => r.user_id as string);
}
