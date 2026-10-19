import QRCode from 'qrcode';
import { getPool, tx } from '../db/pool.js';
import { registrationSchema, maskCpf } from '../../shared/validation.js';
import { cpfBlindIndex, decrypt, encrypt, randomCode, randomToken, sha256 } from '../lib/crypto.js';
import { AppError, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { loadConfig } from '../config.js';
import { isRegistrationWindow, type EventRow } from './events.js';
import { enqueueEmail } from './email-queue.js';

/** Conteúdo do QR Code: endereço da página da inscrição, contendo só o token aleatório. */
export const qrContent = (token: string) => `${loadConfig().PUBLIC_URL.replace(/\/$/, '')}/i/${token}`;

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Extrai o token de um conteúdo lido pela câmera (URL da inscrição ou token puro). */
export function extractToken(raw: string): string | null {
  const v = raw.trim();
  if (TOKEN_RE.test(v)) return v;
  const m = v.match(/\/i\/([A-Za-z0-9_-]{43})(?:[?#].*)?$/);
  return m ? m[1] : null;
}

export async function qrPng(token: string) {
  return QRCode.toBuffer(qrContent(token), { type: 'png', errorCorrectionLevel: 'M', margin: 2, width: 360 });
}

export async function qrSvg(content: string) {
  return QRCode.toString(content, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
}

async function newProtocol(c: { query: (q: string, p: unknown[]) => Promise<{ rowCount: number | null }> }) {
  for (let i = 0; i < 5; i++) {
    const p = `${new Date().getFullYear()}-${randomCode(8)}`;
    const r = await c.query(`SELECT 1 FROM registrations WHERE protocol = $1`, [p]);
    if (!r.rowCount) return p;
  }
  throw new Error('Não foi possível gerar protocolo único');
}

export interface RegisterResult {
  protocol: string;
  token: string;
  emailStatus: 'pendente' | 'enviado' | 'falhou';
}

export async function register(eventId: string, input: unknown, ip?: string): Promise<RegisterResult> {
  const v = registrationSchema.parse(input);
  const cpfHash = cpfBlindIndex(v.cpf);
  try {
    return await tx(async (c) => {
      // Bloqueia a linha do evento: inscrições simultâneas são serializadas e o limite de vagas é respeitado
      const ev = await c.query<EventRow>(`SELECT * FROM events WHERE id = $1 FOR UPDATE`, [eventId]);
      const e = ev.rows[0];
      if (!e) throw notFound('Evento não encontrado.');
      const s = await c.query(`SELECT min(starts_at) AS a, max(ends_at) AS b FROM event_sessions WHERE event_id = $1`, [eventId]);
      if (!isRegistrationWindow(e, s.rows[0].b)) {
        const notYet = e.status === 'publicado' && new Date() < e.registration_opens_at;
        throw new AppError(409, 'inscricoes_fechadas', notYet ? 'As inscrições para este evento ainda não foram abertas.' : 'As inscrições para este evento estão encerradas.');
      }
      if (e.capacity !== null) {
        const n = await c.query(`SELECT count(*)::int AS n FROM registrations WHERE event_id = $1 AND status = 'confirmada'`, [eventId]);
        if (n.rows[0].n >= e.capacity) throw new AppError(409, 'vagas_esgotadas', 'Não há mais vagas disponíveis para este evento.');
      }
      let schoolId: string | null = null;
      let schoolOther: string | null = null;
      if (v.schoolId) {
        const sc = await c.query(`SELECT id FROM schools WHERE id = $1 AND active`, [v.schoolId]);
        if (!sc.rowCount) throw new AppError(400, 'escola_invalida', 'Escola não encontrada. Selecione outra ou informe a instituição.');
        schoolId = v.schoolId;
      } else {
        schoolOther = v.schoolOther!.trim();
      }
      // Pessoa identificada pelo índice cego do CPF; os dados de contato são atualizados com os mais recentes informados
      const p = await c.query(
        `INSERT INTO participants(full_name, cpf_hash, cpf_enc, cpf_masked, email, phone)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (cpf_hash) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email, phone = EXCLUDED.phone, updated_at = now()
         RETURNING id`,
        [v.fullName, cpfHash, encrypt(v.cpf), maskCpf(v.cpf), v.email, v.phone],
      );
      const participantId = p.rows[0].id;
      const dup = await c.query(`SELECT 1 FROM registrations WHERE event_id = $1 AND participant_id = $2 AND status = 'confirmada'`, [eventId, participantId]);
      if (dup.rowCount) throw new AppError(409, 'ja_inscrito', 'Já existe uma inscrição confirmada com este CPF neste evento. A confirmação pode ser reenviada para o e-mail cadastrado.');
      const token = randomToken();
      const protocol = await newProtocol(c);
      const r = await c.query(
        `INSERT INTO registrations(protocol, event_id, participant_id, school_id, school_other, qr_token_hash, qr_token_enc)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [protocol, eventId, participantId, schoolId, schoolOther, sha256(token), encrypt(token)],
      );
      await enqueueEmail(c, { kind: 'confirmacao', to: v.email, registrationId: r.rows[0].id });
      return { protocol, token, emailStatus: 'pendente' as const };
    });
  } catch (err) {
    // Corrida entre duas requisições com o mesmo CPF: a restrição única do banco decide
    if ((err as { code?: string }).code === '23505' && String((err as { constraint?: string }).constraint).startsWith('registrations_unique')) {
      throw new AppError(409, 'ja_inscrito', 'Já existe uma inscrição confirmada com este CPF neste evento.');
    }
    throw err;
  }
}

/** Página pública da inscrição, acessada pelo token. Só devolve dados que o próprio titular informou. */
export async function getByToken(token: string) {
  if (!TOKEN_RE.test(token)) return null;
  const { rows } = await getPool().query(
    `SELECT r.id, r.protocol, r.status, r.created_at, r.event_id, p.full_name, coalesce(s.name, r.school_other) AS school,
            (SELECT status FROM email_messages m WHERE m.registration_id = r.id AND m.kind = 'confirmacao' ORDER BY created_at DESC LIMIT 1) AS email_status
       FROM registrations r JOIN participants p ON p.id = r.participant_id LEFT JOIN schools s ON s.id = r.school_id
      WHERE r.qr_token_hash = $1`,
    [sha256(token)],
  );
  return rows[0] ?? null;
}

/** Reenvio solicitado pelo próprio participante: sempre vai para o e-mail já cadastrado. Resposta neutra para não revelar inscrições. */
export async function requestResend(eventId: string, cpf: string) {
  const { rows } = await getPool().query(
    `SELECT r.id, p.email FROM registrations r JOIN participants p ON p.id = r.participant_id
      WHERE r.event_id = $1 AND p.cpf_hash = $2 AND r.status = 'confirmada'`,
    [eventId, cpfBlindIndex(cpf)],
  );
  if (!rows[0]) return;
  await enqueueEmail(getPool(), { kind: 'confirmacao', to: rows[0].email, registrationId: rows[0].id, ignoreIfInflight: true });
}

export async function getTokenForRegistration(registrationId: string) {
  const { rows } = await getPool().query(`SELECT qr_token_enc FROM registrations WHERE id = $1`, [registrationId]);
  return rows[0] ? decrypt(rows[0].qr_token_enc) : null;
}

/** Substitui o token: o QR Code anterior deixa de valer imediatamente. */
export async function rotateToken(registrationId: string, userId: string, reason: string, ip?: string) {
  return tx(async (c) => {
    const token = randomToken();
    const r = await c.query(
      `UPDATE registrations SET qr_token_hash = $2, qr_token_enc = $3, qr_token_version = qr_token_version + 1
        WHERE id = $1 AND status = 'confirmada' RETURNING id, (SELECT email FROM participants p WHERE p.id = participant_id) AS email`,
      [registrationId, sha256(token), encrypt(token)],
    );
    if (!r.rowCount) throw notFound('Inscrição confirmada não encontrada.');
    await audit(c, { userId, action: 'inscricao.substituir_qrcode', entityType: 'inscricao', entityId: registrationId, details: { motivo: reason }, ip });
    await enqueueEmail(c, { kind: 'confirmacao', to: r.rows[0].email, registrationId, ignoreIfInflight: true, createdBy: userId });
  });
}

export async function cancelRegistration(registrationId: string, userId: string, reason: string, ip?: string) {
  return tx(async (c) => {
    const r = await c.query(
      `UPDATE registrations SET status = 'cancelada', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3
        WHERE id = $1 AND status = 'confirmada' RETURNING event_id`,
      [registrationId, userId, reason],
    );
    if (!r.rowCount) throw notFound('Inscrição confirmada não encontrada.');
    await audit(c, { userId, action: 'inscricao.cancelar', entityType: 'inscricao', entityId: registrationId, details: { motivo: reason, evento: r.rows[0].event_id }, ip });
  });
}

export async function listRegistrations(eventId: string, q?: string) {
  const params: unknown[] = [eventId];
  let filter = '';
  if (q && q.trim()) {
    params.push(`%${q.trim()}%`, q.trim().toUpperCase());
    filter = `AND (p.full_name ILIKE $2 OR r.protocol = $3)`;
  }
  const { rows } = await getPool().query(
    `SELECT r.id, r.protocol, r.status, r.created_at, r.cancel_reason, p.full_name, p.cpf_masked, p.email, p.phone,
            coalesce(s.name, r.school_other) AS school, rp.attended_sessions, rp.total_sessions, rp.attendance_percent, rp.meets_criterion,
            (SELECT status FROM email_messages m WHERE m.registration_id = r.id AND m.kind = 'confirmacao' ORDER BY created_at DESC LIMIT 1) AS email_status,
            (SELECT number FROM certificates c WHERE c.registration_id = r.id AND c.status = 'valido') AS certificate_number
       FROM registrations r JOIN participants p ON p.id = r.participant_id LEFT JOIN schools s ON s.id = r.school_id
       JOIN registration_progress rp ON rp.registration_id = r.id
      WHERE r.event_id = $1 ${filter}
      ORDER BY p.full_name`,
    params,
  );
  return rows;
}
