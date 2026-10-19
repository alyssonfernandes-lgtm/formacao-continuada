import type pg from 'pg';
import { getPool, tx } from '../db/pool.js';
import { randomCode } from '../lib/crypto.js';
import { AppError, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { fmtPeriod } from '../lib/time.js';
import { getSettings } from './settings.js';
import { enqueueEmail } from './email-queue.js';
import type { CertificateSnapshot } from './certificate-pdf.js';

export async function eligibility(eventId: string) {
  const { rows } = await getPool().query(
    `SELECT rp.registration_id, rp.attended_sessions, rp.total_sessions, rp.attended_hours, rp.total_session_hours,
            rp.attendance_percent, rp.meets_criterion, rp.certifiable_hours, p.full_name, coalesce(s.name, r.school_other) AS school,
            c.id AS certificate_id, c.number AS certificate_number, c.issued_at,
            (SELECT status FROM email_messages m WHERE m.certificate_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS email_status
       FROM registration_progress rp
       JOIN registrations r ON r.id = rp.registration_id
       JOIN participants p ON p.id = r.participant_id
       LEFT JOIN schools s ON s.id = r.school_id
       LEFT JOIN certificates c ON c.registration_id = r.id AND c.status = 'valido'
      WHERE rp.event_id = $1 AND rp.status = 'confirmada'
      ORDER BY p.full_name`,
    [eventId],
  );
  return rows;
}

async function snapshotFor(c: pg.PoolClient, registrationId: string): Promise<{ snap: CertificateSnapshot; hours: number; eligible: boolean }> {
  const s = await getSettings(c);
  const { rows } = await c.query(
    `SELECT p.full_name, p.cpf_masked, e.title, e.location, e.modality, e.promoter, e.cert_signer_name, e.cert_signer_role,
            rp.first_start, rp.last_end, rp.certifiable_hours, rp.meets_criterion
       FROM registration_progress rp JOIN registrations r ON r.id = rp.registration_id
       JOIN participants p ON p.id = r.participant_id JOIN events e ON e.id = r.event_id
      WHERE rp.registration_id = $1`,
    [registrationId],
  );
  const r = rows[0];
  if (!r) throw notFound('Inscrição não encontrada.');
  return {
    eligible: r.meets_criterion,
    hours: Number(r.certifiable_hours),
    snap: {
      participantName: r.full_name,
      cpfMasked: r.cpf_masked,
      eventTitle: r.title,
      period: fmtPeriod(r.first_start, r.last_end, s.timezone),
      location: r.location,
      modality: r.modality,
      promoter: r.promoter || s.department,
      // Signatário do evento; se o evento não definir, vale o padrão das Configurações
      signerName: r.cert_signer_name || s.defaultSignerName,
      signerRole: r.cert_signer_name ? r.cert_signer_role : s.defaultSignerRole,
      department: s.department,
      municipality: s.municipality,
    },
  };
}

async function insertCertificate(c: pg.PoolClient, registrationId: string, userId: string, replacesId: string | null, emailTo: string) {
  const { snap, hours, eligible } = await snapshotFor(c, registrationId);
  if (!eligible) throw new AppError(409, 'nao_elegivel', 'A inscrição não cumpre o critério de presença do evento.');
  const seq = await c.query(`SELECT nextval('certificate_number_seq') AS n`);
  const number = `${new Date().getFullYear()}.${String(seq.rows[0].n).padStart(6, '0')}`;
  const code = randomCode(16).replace(/(.{4})(?=.)/g, '$1-');
  const ins = await c.query(
    `INSERT INTO certificates(number, verification_code, registration_id, hours, snapshot, issued_by, replaces_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (registration_id) WHERE status = 'valido' DO NOTHING RETURNING id`,
    [number, code, registrationId, hours, snap, userId, replacesId],
  );
  if (!ins.rows[0]) return null; // já havia certificado válido: nada é duplicado
  await enqueueEmail(c, { kind: 'certificado', to: emailTo, certificateId: ins.rows[0].id, createdBy: userId });
  return ins.rows[0].id as string;
}

/**
 * Autoriza a emissão e gera os certificados de quem cumpre o critério. Pode ser chamado de novo (ex.: após
 * correção de presença): só cria certificados que ainda não existem.
 */
export async function releaseCertificates(eventId: string, userId: string, ip?: string) {
  return tx(async (c) => {
    const ev = await c.query(`SELECT id, status FROM events WHERE id = $1 FOR UPDATE`, [eventId]);
    if (!ev.rows[0]) throw notFound('Evento não encontrado.');
    if (ev.rows[0].status === 'cancelado' || ev.rows[0].status === 'rascunho') throw new AppError(409, 'evento_invalido', 'Eventos em rascunho ou cancelados não emitem certificados.');
    const t = await c.query(`SELECT count(*)::int AS n, max(ends_at) AS last_end FROM event_sessions WHERE event_id = $1`, [eventId]);
    if (!t.rows[0].n || new Date(t.rows[0].last_end) > new Date()) {
      throw new AppError(409, 'evento_nao_encerrado', 'A emissão só pode ser autorizada após o término da última sessão do evento.');
    }
    await c.query(`UPDATE events SET certificates_released_at = coalesce(certificates_released_at, now()), certificates_released_by = coalesce(certificates_released_by, $2) WHERE id = $1`, [eventId, userId]);
    const pend = await c.query(
      `SELECT rp.registration_id, p.email FROM registration_progress rp
         JOIN registrations r ON r.id = rp.registration_id JOIN participants p ON p.id = r.participant_id
        WHERE rp.event_id = $1 AND rp.meets_criterion
          AND NOT EXISTS (SELECT 1 FROM certificates c WHERE c.registration_id = rp.registration_id AND c.status = 'valido')`,
      [eventId],
    );
    let created = 0;
    for (const r of pend.rows) if (await insertCertificate(c, r.registration_id, userId, null, r.email)) created++;
    await audit(c, { userId, action: 'certificados.emitir', entityType: 'evento', entityId: eventId, details: { emitidos: created }, ip });
    return { created };
  });
}

/** Reemissão: o certificado anterior é marcado como substituído e permanece no histórico. */
export async function reissueCertificate(certificateId: string, userId: string, reason: string, ip?: string) {
  return tx(async (c) => {
    const old = await c.query(
      `SELECT c.id, c.registration_id, p.email FROM certificates c JOIN registrations r ON r.id = c.registration_id JOIN participants p ON p.id = r.participant_id
        WHERE c.id = $1 AND c.status = 'valido' FOR UPDATE OF c`,
      [certificateId],
    );
    if (!old.rows[0]) throw notFound('Certificado válido não encontrado.');
    await c.query(`UPDATE certificates SET status = 'substituido', invalidated_at = now(), invalidated_by = $2, invalidated_reason = $3 WHERE id = $1`, [certificateId, userId, reason]);
    await c.query(`UPDATE email_messages SET status = 'falhou', last_error = 'Certificado substituído antes do envio' WHERE certificate_id = $1 AND status = 'pendente'`, [certificateId]);
    const id = await insertCertificate(c, old.rows[0].registration_id, userId, certificateId, old.rows[0].email);
    await audit(c, { userId, action: 'certificado.reemitir', entityType: 'certificado', entityId: certificateId, details: { novo: id, motivo: reason }, ip });
    return id;
  });
}

export async function revokeCertificate(certificateId: string, userId: string, reason: string, ip?: string) {
  return tx(async (c) => {
    const r = await c.query(
      `UPDATE certificates SET status = 'revogado', invalidated_at = now(), invalidated_by = $2, invalidated_reason = $3 WHERE id = $1 AND status = 'valido' RETURNING id`,
      [certificateId, userId, reason],
    );
    if (!r.rowCount) throw notFound('Certificado válido não encontrado.');
    await audit(c, { userId, action: 'certificado.revogar', entityType: 'certificado', entityId: certificateId, details: { motivo: reason }, ip });
  });
}

export async function issueSingle(registrationId: string, userId: string, ip?: string) {
  return tx(async (c) => {
    const ev = await c.query(
      `SELECT e.certificates_released_at, p.email FROM registrations r JOIN events e ON e.id = r.event_id JOIN participants p ON p.id = r.participant_id WHERE r.id = $1 FOR UPDATE OF e`,
      [registrationId],
    );
    if (!ev.rows[0]) throw notFound('Inscrição não encontrada.');
    if (!ev.rows[0].certificates_released_at) throw new AppError(409, 'emissao_nao_autorizada', 'A emissão de certificados deste evento ainda não foi autorizada.');
    const id = await insertCertificate(c, registrationId, userId, null, ev.rows[0].email);
    if (!id) throw new AppError(409, 'ja_emitido', 'Esta inscrição já possui certificado válido.');
    await audit(c, { userId, action: 'certificado.emitir_individual', entityType: 'certificado', entityId: id, ip });
    return id;
  });
}

const CODE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export async function findByCode(code: string) {
  const norm = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-');
  if (!CODE_RE.test(norm)) return null;
  const { rows } = await getPool().query(
    `SELECT c.*, (SELECT n.verification_code FROM certificates n WHERE n.replaces_id = c.id LIMIT 1) AS replaced_by_code FROM certificates c WHERE verification_code = $1`,
    [norm],
  );
  return rows[0] ?? null;
}

export async function getCertificate(id: string) {
  const { rows } = await getPool().query(`SELECT * FROM certificates WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function certificateHistory(registrationId: string) {
  const { rows } = await getPool().query(
    `SELECT id, number, verification_code, status, hours, issued_at, invalidated_at, invalidated_reason, replaces_id
       FROM certificates WHERE registration_id = $1 ORDER BY issued_at DESC`,
    [registrationId],
  );
  return rows;
}
