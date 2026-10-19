import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { ip, reasonOf, requirePerm, requireUser, uuidParam } from '../http.js';
import { audit } from '../lib/audit.js';
import { AppError, notFound } from '../lib/errors.js';
import { deleteLogo, getSettings, saveLogo, saveSettings } from '../services/settings.js';
import { createEvent, getEvent, getStaff, listAdminEvents, setStaff, updateEvent } from '../services/events.js';
import { cancelRegistration, listRegistrations, rotateToken } from '../services/registrations.js';
import { correctAttendance, listAttendances, revokeAttendance } from '../services/checkin.js';
import { certificateHistory, eligibility, getCertificate, issueSingle, reissueCertificate, releaseCertificates, revokeCertificate } from '../services/certificates.js';
import { renderCertificatePdf } from '../services/certificate-pdf.js';
import { enqueueEmail, retryEmail } from '../services/email-queue.js';
import { hashPassword } from '../services/auth.js';
import { loadConfig, smtpConfigured } from '../config.js';
import { passwordSchema } from '../../shared/validation.js';
import { can } from '../../shared/types.js';

export async function adminRoutes(app: FastifyInstance) {
  // ---------- Configurações institucionais ----------
  app.get('/settings', { preHandler: requirePerm('settings.manage') }, async () => getSettings());
  app.put('/settings', { preHandler: requirePerm('settings.manage') }, async (req) => {
    const u = requireUser(req);
    const saved = await saveSettings(getPool(), req.body, u.id);
    await audit(getPool(), { userId: u.id, action: 'configuracoes.alterar', details: { campos: Object.keys(saved) }, ip: ip(req) });
    return getSettings();
  });
  app.put('/settings/logo', { preHandler: requirePerm('settings.manage') }, async (req) => {
    const u = requireUser(req);
    const { mime, data } = z.object({ mime: z.enum(['image/png', 'image/jpeg']), data: z.string().max(2_800_000) }).parse(req.body);
    const buf = Buffer.from(data, 'base64');
    const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const jpg = buf[0] === 0xff && buf[1] === 0xd8;
    if ((mime === 'image/png' && !png) || (mime === 'image/jpeg' && !jpg)) throw new AppError(400, 'imagem_invalida', 'Envie uma imagem PNG ou JPEG válida.');
    if (buf.length > 2 * 1024 * 1024) throw new AppError(400, 'imagem_grande', 'A imagem deve ter até 2 MB.');
    await saveLogo(getPool(), mime, buf, u.id);
    await audit(getPool(), { userId: u.id, action: 'configuracoes.logo', details: { bytes: buf.length }, ip: ip(req) });
    return getSettings();
  });
  app.delete('/settings/logo', { preHandler: requirePerm('settings.manage') }, async (req) => {
    await deleteLogo(getPool());
    await audit(getPool(), { userId: requireUser(req).id, action: 'configuracoes.remover_logo', ip: ip(req) });
    return getSettings();
  });

  // ---------- Usuários ----------
  const userBody = z.object({
    name: z.string().trim().min(2).max(200),
    email: z.string().trim().toLowerCase().email().max(254),
    role: z.enum(['admin', 'coordenacao', 'credenciamento', 'consulta']),
    active: z.boolean().default(true),
    password: passwordSchema.optional().or(z.literal('').transform(() => undefined)),
  });
  app.get('/users', { preHandler: requirePerm('users.manage', 'events.manage') }, async (req) => {
    const u = requireUser(req);
    const full = can(u.role, 'users.manage');
    const { rows } = await getPool().query(
      `SELECT id, name, email, role, active, last_login_at, created_at, (locked_until > now()) AS locked FROM users ${full ? '' : `WHERE active AND role = 'credenciamento'`} ORDER BY name`,
    );
    return rows;
  });
  app.post('/users', { preHandler: requirePerm('users.manage') }, async (req, reply) => {
    const u = requireUser(req);
    const v = userBody.parse(req.body);
    if (!v.password) throw new AppError(400, 'validacao', 'Defina uma senha inicial.', { fields: { password: 'Defina uma senha inicial.' } });
    try {
      const { rows } = await getPool().query(`INSERT INTO users(name, email, role, active, password_hash) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [
        v.name, v.email, v.role, v.active, await hashPassword(v.password),
      ]);
      await audit(getPool(), { userId: u.id, action: 'usuario.criar', entityType: 'usuario', entityId: rows[0].id, details: { perfil: v.role }, ip: ip(req) });
      return reply.status(201).send({ id: rows[0].id });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new AppError(409, 'email_em_uso', 'Já existe usuário com este e-mail.');
      throw e;
    }
  });
  app.put<{ Params: { id: string } }>('/users/:id', { preHandler: requirePerm('users.manage') }, async (req) => {
    const u = requireUser(req);
    const id = uuidParam(req.params.id);
    const v = userBody.parse(req.body);
    if (id === u.id && (v.role !== 'admin' || !v.active)) throw new AppError(400, 'auto_rebaixamento', 'Você não pode remover o próprio perfil de administrador nem desativar a própria conta.');
    const res = await getPool().query(
      `UPDATE users SET name = $2, email = $3, role = $4, active = $5,
         password_hash = coalesce($6, password_hash), password_changed_at = CASE WHEN $6::text IS NULL THEN password_changed_at ELSE now() END,
         failed_logins = 0, locked_until = NULL
       WHERE id = $1 RETURNING id`,
      [id, v.name, v.email, v.role, v.active, v.password ? await hashPassword(v.password) : null],
    );
    if (!res.rowCount) throw notFound('Usuário não encontrado.');
    if (!v.active || v.password) await getPool().query(`DELETE FROM user_sessions WHERE user_id = $1`, [id]);
    await audit(getPool(), { userId: u.id, action: 'usuario.alterar', entityType: 'usuario', entityId: id, details: { perfil: v.role, ativo: v.active, senha_redefinida: Boolean(v.password) }, ip: ip(req) });
    return { ok: true };
  });

  // ---------- Escolas ----------
  const schoolBody = z.object({ name: z.string().trim().min(2).max(200), unit: z.string().trim().max(200).default(''), active: z.boolean().default(true) });
  app.get('/schools', { preHandler: requirePerm('events.manage', 'reports.summary') }, async () => {
    const { rows } = await getPool().query(`SELECT id, name, unit, active FROM schools ORDER BY name`);
    return rows;
  });
  app.post('/schools', { preHandler: requirePerm('events.manage') }, async (req, reply) => {
    const v = schoolBody.parse(req.body);
    try {
      const { rows } = await getPool().query(`INSERT INTO schools(name, unit, active) VALUES ($1, nullif($2, ''), $3) RETURNING id`, [v.name, v.unit, v.active]);
      await audit(getPool(), { userId: requireUser(req).id, action: 'escola.criar', entityType: 'escola', entityId: rows[0].id, details: { nome: v.name }, ip: ip(req) });
      return reply.status(201).send({ id: rows[0].id });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new AppError(409, 'duplicada', 'Já existe escola com este nome.');
      throw e;
    }
  });
  app.put<{ Params: { id: string } }>('/schools/:id', { preHandler: requirePerm('events.manage') }, async (req) => {
    const v = schoolBody.parse(req.body);
    const id = uuidParam(req.params.id);
    const r = await getPool().query(`UPDATE schools SET name = $2, unit = nullif($3, ''), active = $4 WHERE id = $1`, [id, v.name, v.unit, v.active]);
    if (!r.rowCount) throw notFound();
    await audit(getPool(), { userId: requireUser(req).id, action: 'escola.alterar', entityType: 'escola', entityId: id, details: { nome: v.name, ativa: v.active }, ip: ip(req) });
    return { ok: true };
  });

  // ---------- Eventos ----------
  app.get('/events', { preHandler: requirePerm('events.manage', 'reports.summary') }, async () => listAdminEvents());
  app.post('/events', { preHandler: requirePerm('events.manage') }, async (req, reply) => {
    const id = await createEvent(req.body, requireUser(req).id, ip(req));
    return reply.status(201).send({ id });
  });
  app.get<{ Params: { id: string } }>('/events/:id', { preHandler: requirePerm('events.manage', 'reports.summary') }, async (req) => {
    const e = await getEvent(uuidParam(req.params.id));
    if (!e) throw notFound('Evento não encontrado.');
    return e;
  });
  app.put<{ Params: { id: string } }>('/events/:id', { preHandler: requirePerm('events.manage') }, async (req) => {
    await updateEvent(uuidParam(req.params.id), req.body, requireUser(req).id, ip(req));
    return getEvent(req.params.id);
  });
  app.get<{ Params: { id: string } }>('/events/:id/staff', { preHandler: requirePerm('events.manage') }, async (req) => getStaff(uuidParam(req.params.id)));
  app.put<{ Params: { id: string } }>('/events/:id/staff', { preHandler: requirePerm('events.manage') }, async (req) => {
    const ids = z.array(z.string().uuid()).max(200).parse((req.body as { userIds?: unknown })?.userIds ?? []);
    await setStaff(uuidParam(req.params.id), ids, requireUser(req).id, ip(req));
    return { ok: true };
  });

  // ---------- Inscrições ----------
  app.get<{ Params: { id: string }; Querystring: { q?: string } }>('/events/:id/registrations', { preHandler: requirePerm('registrations.view') }, async (req) =>
    listRegistrations(uuidParam(req.params.id), req.query.q?.slice(0, 100)),
  );
  app.post<{ Params: { id: string } }>('/registrations/:id/cancel', { preHandler: requirePerm('registrations.manage') }, async (req) => {
    await cancelRegistration(uuidParam(req.params.id), requireUser(req).id, reasonOf(req.body), ip(req));
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/registrations/:id/rotate-qr', { preHandler: requirePerm('registrations.manage') }, async (req) => {
    await rotateToken(uuidParam(req.params.id), requireUser(req).id, reasonOf(req.body), ip(req));
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/registrations/:id/resend-confirmation', { preHandler: requirePerm('registrations.manage') }, async (req) => {
    const id = uuidParam(req.params.id);
    const { rows } = await getPool().query(`SELECT p.email FROM registrations r JOIN participants p ON p.id = r.participant_id WHERE r.id = $1 AND r.status = 'confirmada'`, [id]);
    if (!rows[0]) throw notFound('Inscrição confirmada não encontrada.');
    const msg = await enqueueEmail(getPool(), { kind: 'confirmacao', to: rows[0].email, registrationId: id, createdBy: requireUser(req).id });
    if (!msg) throw new AppError(409, 'em_andamento', 'Já existe um envio em andamento para esta inscrição.');
    await audit(getPool(), { userId: requireUser(req).id, action: 'inscricao.reenviar_confirmacao', entityType: 'inscricao', entityId: id, ip: ip(req) });
    return { ok: true };
  });

  // ---------- Presenças ----------
  app.get<{ Params: { id: string } }>('/events/:id/attendances', { preHandler: requirePerm('registrations.view') }, async (req) => listAttendances(uuidParam(req.params.id)));
  app.post('/attendances', { preHandler: requirePerm('attendance.correct') }, async (req, reply) => {
    const v = z.object({ registrationId: z.string().uuid(), sessionId: z.string().uuid(), justification: z.string().max(1000) }).parse(req.body);
    const id = await correctAttendance(requireUser(req), v, ip(req));
    return reply.status(201).send({ id });
  });
  app.post<{ Params: { id: string } }>('/attendances/:id/revoke', { preHandler: requirePerm('attendance.correct') }, async (req) => {
    await revokeAttendance(requireUser(req), uuidParam(req.params.id), reasonOf(req.body), ip(req));
    return { ok: true };
  });

  // ---------- Certificados ----------
  app.get<{ Params: { id: string } }>('/events/:id/certificates', { preHandler: requirePerm('certificates.manage') }, async (req) => eligibility(uuidParam(req.params.id)));
  app.post<{ Params: { id: string } }>('/events/:id/certificates/release', { preHandler: requirePerm('certificates.manage') }, async (req) =>
    releaseCertificates(uuidParam(req.params.id), requireUser(req).id, ip(req)),
  );
  app.post<{ Params: { id: string } }>('/registrations/:id/certificate', { preHandler: requirePerm('certificates.manage') }, async (req) => ({
    id: await issueSingle(uuidParam(req.params.id), requireUser(req).id, ip(req)),
  }));
  app.get<{ Params: { id: string } }>('/registrations/:id/certificates', { preHandler: requirePerm('certificates.manage') }, async (req) => certificateHistory(uuidParam(req.params.id)));
  app.post<{ Params: { id: string } }>('/certificates/:id/reissue', { preHandler: requirePerm('certificates.manage') }, async (req) => ({
    id: await reissueCertificate(uuidParam(req.params.id), requireUser(req).id, reasonOf(req.body), ip(req)),
  }));
  app.post<{ Params: { id: string } }>('/certificates/:id/revoke', { preHandler: requirePerm('certificates.manage') }, async (req) => {
    await revokeCertificate(uuidParam(req.params.id), requireUser(req).id, reasonOf(req.body), ip(req));
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/certificates/:id/resend', { preHandler: requirePerm('certificates.manage') }, async (req) => {
    const id = uuidParam(req.params.id);
    const { rows } = await getPool().query(
      `SELECT p.email FROM certificates c JOIN registrations r ON r.id = c.registration_id JOIN participants p ON p.id = r.participant_id WHERE c.id = $1 AND c.status = 'valido'`,
      [id],
    );
    if (!rows[0]) throw notFound('Certificado válido não encontrado.');
    const m = await enqueueEmail(getPool(), { kind: 'certificado', to: rows[0].email, certificateId: id, createdBy: requireUser(req).id });
    if (!m) throw new AppError(409, 'em_andamento', 'Já existe um envio em andamento para este certificado.');
    await audit(getPool(), { userId: requireUser(req).id, action: 'certificado.reenviar', entityType: 'certificado', entityId: id, ip: ip(req) });
    return { ok: true };
  });
  app.get<{ Params: { id: string } }>('/certificates/:id/pdf', { preHandler: requirePerm('certificates.manage') }, async (req, reply) => {
    const c = await getCertificate(uuidParam(req.params.id));
    if (!c) throw notFound();
    return reply.type('application/pdf').header('Content-Disposition', `inline; filename="certificado-${c.number}.pdf"`).send(await renderCertificatePdf(c, await getSettings()));
  });

  // ---------- Fila de e-mails ----------
  app.get<{ Querystring: { status?: string; kind?: string; eventId?: string } }>('/emails', { preHandler: requirePerm('emails.view') }, async (req) => {
    const params: unknown[] = [];
    const where: string[] = [];
    if (req.query.status && ['pendente', 'enviando', 'enviado', 'falhou'].includes(req.query.status)) {
      params.push(req.query.status);
      where.push(`m.status = $${params.length}`);
    }
    if (req.query.kind && ['confirmacao', 'certificado', 'redefinir_senha'].includes(req.query.kind)) {
      params.push(req.query.kind);
      where.push(`m.kind = $${params.length}`);
    }
    if (req.query.eventId && /^[0-9a-f-]{36}$/i.test(req.query.eventId)) {
      params.push(req.query.eventId);
      where.push(`coalesce(r.event_id, r2.event_id) = $${params.length}`);
    }
    const { rows } = await getPool().query(
      `SELECT m.id, m.kind, m.to_address, m.status, m.attempts, m.max_attempts, m.last_error, m.next_attempt_at, m.sent_at, m.created_at,
              coalesce(p.full_name, p2.full_name, u.name) AS recipient_name, coalesce(e.title, e2.title) AS event_title
         FROM email_messages m
         LEFT JOIN registrations r ON r.id = m.registration_id LEFT JOIN participants p ON p.id = r.participant_id LEFT JOIN events e ON e.id = r.event_id
         LEFT JOIN certificates c ON c.id = m.certificate_id LEFT JOIN registrations r2 ON r2.id = c.registration_id
         LEFT JOIN participants p2 ON p2.id = r2.participant_id LEFT JOIN events e2 ON e2.id = r2.event_id
         LEFT JOIN users u ON u.id = m.user_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY m.created_at DESC LIMIT 300`,
      params,
    );
    const counts = await getPool().query(`SELECT status, count(*)::int AS n FROM email_messages GROUP BY status`);
    return { smtpConfigured: smtpConfigured(loadConfig()), counts: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])), messages: rows };
  });
  app.post<{ Params: { id: string } }>('/emails/:id/retry', { preHandler: requirePerm('emails.view') }, async (req) => {
    const id = uuidParam(req.params.id);
    try {
      if (!(await retryEmail(getPool(), id))) throw new AppError(409, 'nao_falhou', 'Só é possível tentar novamente mensagens com falha.');
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new AppError(409, 'em_andamento', 'Já existe outro envio em andamento para o mesmo destinatário e documento.');
      throw e;
    }
    await audit(getPool(), { userId: requireUser(req).id, action: 'email.nova_tentativa', entityType: 'email', entityId: id, ip: ip(req) });
    return { ok: true };
  });

  // ---------- Auditoria ----------
  app.get<{ Querystring: { page?: string; action?: string } }>('/audit', { preHandler: requirePerm('audit.view') }, async (req) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const params: unknown[] = [(page - 1) * 100];
    let where = '';
    if (req.query.action) {
      params.push(`${req.query.action.slice(0, 50)}%`);
      where = `WHERE a.action LIKE $2`;
    }
    const { rows } = await getPool().query(
      `SELECT a.id, a.at, a.action, a.entity_type, a.entity_id, a.details, host(a.ip) AS ip, u.name AS user_name
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ${where} ORDER BY a.at DESC, a.id DESC LIMIT 100 OFFSET $1`,
      params,
    );
    return rows;
  });
}
