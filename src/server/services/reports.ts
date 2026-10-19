import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { getSettings } from './settings.js';

export const filterSchema = z.object({
  eventId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('').transform(() => undefined)),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('').transform(() => undefined)),
  schoolId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
  unit: z.string().max(200).optional().or(z.literal('').transform(() => undefined)),
  registrationStatus: z.enum(['confirmada', 'cancelada']).optional().or(z.literal('').transform(() => undefined)),
  presenceStatus: z.enum(['presente', 'ausente', 'aguardando']).optional().or(z.literal('').transform(() => undefined)),
  certificateStatus: z.enum(['emitido', 'pendente', 'nao_elegivel']).optional().or(z.literal('').transform(() => undefined)),
});
export type ReportFilters = z.infer<typeof filterSchema>;

/** Uma linha por inscrição, com as situações derivadas usadas em todos os indicadores e exportações. */
export async function baseQuery(f: ReportFilters) {
  const tz = (await getSettings()).timezone;
  const params: unknown[] = [tz];
  const where: string[] = [`e.status <> 'rascunho'`];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.eventId) add('e.id = ?', f.eventId);
  if (f.from) add(`rp.first_start >= (?::date)::timestamp AT TIME ZONE $1`, f.from);
  if (f.to) add(`rp.first_start < ((?::date) + 1)::timestamp AT TIME ZONE $1`, f.to);
  if (f.schoolId) add('r.school_id = ?', f.schoolId);
  if (f.unit) add('s.unit = ?', f.unit);
  if (f.registrationStatus) add('r.status = ?', f.registrationStatus);
  const outer: string[] = [];
  if (f.presenceStatus) {
    params.push(f.presenceStatus);
    outer.push(`presence_status = $${params.length}`);
  }
  if (f.certificateStatus) {
    params.push(f.certificateStatus);
    outer.push(`certificate_status = $${params.length}`);
  }
  const sql = `SELECT * FROM (
    SELECT r.id AS registration_id, r.protocol, r.status AS registration_status, r.created_at AS registered_at,
           e.id AS event_id, e.title AS event_title, e.workload_hours, e.modality, e.location,
           rp.first_start, rp.last_end, rp.total_sessions, rp.attended_sessions, rp.attendance_percent, rp.meets_criterion, rp.certifiable_hours,
           p.id AS participant_id, p.full_name, p.cpf_enc, p.cpf_masked, p.email, p.phone,
           coalesce(s.name, r.school_other) AS school, s.unit,
           c.number AS certificate_number, c.verification_code, c.issued_at AS certificate_issued_at, c.hours AS certificate_hours,
           CASE WHEN r.status = 'cancelada' THEN 'cancelada'
                WHEN rp.attended_sessions > 0 THEN 'presente'
                WHEN rp.first_start <= now() THEN 'ausente'
                ELSE 'aguardando' END AS presence_status,
           CASE WHEN c.id IS NOT NULL THEN 'emitido'
                WHEN r.status = 'confirmada' AND rp.meets_criterion AND rp.last_end < now() THEN 'pendente'
                ELSE 'nao_elegivel' END AS certificate_status,
           (SELECT m.status FROM email_messages m WHERE m.registration_id = r.id AND m.kind = 'confirmacao' ORDER BY m.created_at DESC LIMIT 1) AS confirmation_email,
           (SELECT m.status FROM email_messages m WHERE m.certificate_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS certificate_email,
           to_char(rp.first_start AT TIME ZONE $1, 'YYYY-MM') AS month
      FROM registrations r
      JOIN events e ON e.id = r.event_id
      JOIN registration_progress rp ON rp.registration_id = r.id
      JOIN participants p ON p.id = r.participant_id
      LEFT JOIN schools s ON s.id = r.school_id
      LEFT JOIN certificates c ON c.registration_id = r.id AND c.status = 'valido'
     WHERE ${where.join(' AND ')}
  ) base ${outer.length ? `WHERE ${outer.join(' AND ')}` : ''}`;
  return { sql, params };
}

export const INDICATOR_DEFINITIONS = {
  totalRegistrations: 'Todas as inscrições no filtro, inclusive canceladas.',
  confirmed: 'Inscrições com situação "confirmada". Canceladas não entram.',
  cancelled: 'Inscrições canceladas.',
  present: 'Inscrições confirmadas com presença válida em ao menos uma sessão.',
  absent: 'Inscrições confirmadas sem nenhuma presença, em eventos que já começaram.',
  awaiting: 'Inscrições confirmadas em eventos que ainda não começaram.',
  attendanceRate: 'Presentes ÷ (presentes + ausentes). Eventos não iniciados ficam fora do denominador.',
  uniqueParticipants: 'Pessoas distintas (por CPF) entre as inscrições confirmadas. Uma pessoa inscrita em 3 eventos conta 1.',
  uniquePresent: 'Pessoas distintas com ao menos uma presença.',
  certificatesIssued: 'Certificados válidos (exclui substituídos e revogados).',
  certificatesPending: 'Inscrições que cumprem o critério, em eventos encerrados, ainda sem certificado válido.',
  emailsPending: 'Mensagens (confirmação e certificado) ainda na fila, incluindo novas tentativas agendadas.',
  emailsFailed: 'Mensagens que esgotaram as tentativas ou foram recusadas.',
  events: 'Eventos distintos com inscrições no filtro.',
  workloadOffered: 'Soma da carga horária dos eventos no filtro (cada evento conta uma vez).',
  certifiedHours: 'Soma da carga horária dos certificados válidos.',
};

export async function indicators(f: ReportFilters) {
  const { sql, params } = await baseQuery(f);
  const db = getPool();
  const totals = await db.query(
    `WITH b AS (${sql})
     SELECT count(*)::int AS "totalRegistrations",
            count(*) FILTER (WHERE registration_status = 'confirmada')::int AS confirmed,
            count(*) FILTER (WHERE registration_status = 'cancelada')::int AS cancelled,
            count(*) FILTER (WHERE presence_status = 'presente')::int AS present,
            count(*) FILTER (WHERE presence_status = 'ausente')::int AS absent,
            count(*) FILTER (WHERE presence_status = 'aguardando')::int AS awaiting,
            count(DISTINCT participant_id) FILTER (WHERE registration_status = 'confirmada')::int AS "uniqueParticipants",
            count(DISTINCT participant_id) FILTER (WHERE presence_status = 'presente')::int AS "uniquePresent",
            count(*) FILTER (WHERE certificate_status = 'emitido')::int AS "certificatesIssued",
            count(*) FILTER (WHERE certificate_status = 'pendente')::int AS "certificatesPending",
            (count(*) FILTER (WHERE confirmation_email = 'pendente' OR confirmation_email = 'enviando')
              + count(*) FILTER (WHERE certificate_email = 'pendente' OR certificate_email = 'enviando'))::int AS "emailsPending",
            (count(*) FILTER (WHERE confirmation_email = 'falhou') + count(*) FILTER (WHERE certificate_email = 'falhou'))::int AS "emailsFailed",
            count(DISTINCT event_id)::int AS events,
            coalesce(sum(certificate_hours), 0)::float AS "certifiedHours"
       FROM b`,
    params,
  );
  const workload = await db.query(`WITH b AS (${sql}) SELECT coalesce(sum(w), 0)::float AS w FROM (SELECT DISTINCT event_id, workload_hours AS w FROM b) x`, params);
  const t = totals.rows[0];
  const denom = t.present + t.absent;
  const bySchool = await db.query(
    `WITH b AS (${sql})
     SELECT coalesce(school, '(não informada)') AS school, unit,
            count(*) FILTER (WHERE registration_status = 'confirmada')::int AS confirmed,
            count(*) FILTER (WHERE presence_status = 'presente')::int AS present,
            count(*) FILTER (WHERE presence_status = 'ausente')::int AS absent,
            count(DISTINCT participant_id) FILTER (WHERE registration_status = 'confirmada')::int AS unique_participants,
            count(*) FILTER (WHERE certificate_status = 'emitido')::int AS certificates
       FROM b GROUP BY 1, 2 ORDER BY confirmed DESC, 1`,
    params,
  );
  const byEvent = await db.query(
    `WITH b AS (${sql})
     SELECT event_id, event_title, min(first_start) AS first_start, max(workload_hours)::float AS workload_hours,
            count(*) FILTER (WHERE registration_status = 'confirmada')::int AS confirmed,
            count(*) FILTER (WHERE registration_status = 'cancelada')::int AS cancelled,
            count(*) FILTER (WHERE presence_status = 'presente')::int AS present,
            count(*) FILTER (WHERE presence_status = 'ausente')::int AS absent,
            count(*) FILTER (WHERE certificate_status = 'emitido')::int AS certificates,
            count(*) FILTER (WHERE certificate_status = 'pendente')::int AS certificates_pending
       FROM b GROUP BY event_id, event_title ORDER BY first_start DESC NULLS LAST`,
    params,
  );
  const byMonth = await db.query(
    `WITH b AS (${sql})
     SELECT month, count(DISTINCT event_id)::int AS events,
            count(*) FILTER (WHERE registration_status = 'confirmada')::int AS confirmed,
            count(*) FILTER (WHERE presence_status = 'presente')::int AS present
       FROM b WHERE month IS NOT NULL GROUP BY month ORDER BY month`,
    params,
  );
  return {
    totals: { ...t, workloadOffered: workload.rows[0].w, attendanceRate: denom ? Math.round((1000 * t.present) / denom) / 10 : null },
    bySchool: bySchool.rows,
    byEvent: byEvent.rows,
    byMonth: byMonth.rows,
    definitions: INDICATOR_DEFINITIONS,
  };
}
