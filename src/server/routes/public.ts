import type { FastifyInstance } from 'fastify';
import { getPool } from '../db/pool.js';
import { getLogo, getSettings } from '../services/settings.js';
import { getEvent, listPublicEvents } from '../services/events.js';
import { getByToken, qrContent, qrSvg, register, requestResend } from '../services/registrations.js';
import { findByCode } from '../services/certificates.js';
import { renderCertificatePdf } from '../services/certificate-pdf.js';
import { fmtHours } from '../lib/time.js';
import { isValidCpf, onlyDigits } from '../../shared/validation.js';
import { notFound, badRequest } from '../lib/errors.js';

export async function publicRoutes(app: FastifyInstance) {
  app.get('/settings', async () => {
    const s = await getSettings();
    return {
      platformName: s.platformName, municipality: s.municipality, department: s.department, primaryColor: s.primaryColor,
      secondaryColor: s.secondaryColor, contactEmail: s.contactEmail, contactPhone: s.contactPhone, contactAddress: s.contactAddress,
      timezone: s.timezone, hasLogo: s.hasLogo, logoVersion: s.logoVersion, controllerName: s.controllerName, dpoName: s.dpoName,
      dpoContact: s.dpoContact, privacyExtra: s.privacyExtra, retentionCancelledDays: s.retentionCancelledDays,
    };
  });

  app.get('/logo', async (_req, reply) => {
    const logo = await getLogo();
    if (!logo) throw notFound('Logo não configurada.');
    return reply.header('Cache-Control', 'public, max-age=86400').type(logo.mime).send(logo.data);
  });

  app.get('/manifest.webmanifest', async (_req, reply) => {
    const s = await getSettings();
    return reply.type('application/manifest+json').send({
      name: s.platformName,
      short_name: 'Formação',
      start_url: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: s.primaryColor,
      lang: 'pt-BR',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    });
  });

  app.get('/events', async () => {
    const events = await listPublicEvents();
    return events.map(({ certCriterion, certMinPercent, certHoursMode, certSignerName, certSignerRole, ...e }) => e);
  });

  app.get<{ Params: { id: string } }>('/events/:id', async (req) => {
    const e = await getEvent(req.params.id);
    if (!e || e.status === 'rascunho') throw notFound('Evento não encontrado.');
    return e;
  });

  app.get('/schools', async () => {
    const { rows } = await getPool().query(`SELECT id, name, unit FROM schools WHERE active ORDER BY name`);
    return rows;
  });

  app.post<{ Params: { id: string } }>(
    '/events/:id/registrations',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw notFound('Evento não encontrado.');
      const r = await register(req.params.id, req.body, req.ip);
      return reply.status(201).send(r);
    },
  );

  app.post<{ Params: { id: string }; Body: { cpf?: string } }>(
    '/events/:id/resend',
    { config: { rateLimit: { max: 3, timeWindow: '10 minutes' } } },
    async (req) => {
      const cpf = onlyDigits(String(req.body?.cpf ?? ''));
      if (!isValidCpf(cpf)) throw badRequest('CPF inválido.');
      if (/^[0-9a-f-]{36}$/i.test(req.params.id)) await requestResend(req.params.id, cpf);
      // Resposta neutra: não revela se existe inscrição para o CPF
      return { message: 'Se houver inscrição confirmada para este CPF, a confirmação será reenviada ao e-mail cadastrado.' };
    },
  );

  app.get<{ Params: { token: string } }>('/registrations/:token', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const r = await getByToken(req.params.token);
    if (!r) throw notFound('Inscrição não localizada. O link pode ter sido substituído.');
    const e = await getEvent(r.event_id);
    reply.header('Cache-Control', 'no-store');
    return {
      protocol: r.protocol, status: r.status, createdAt: r.created_at, name: r.full_name, school: r.school, emailStatus: r.email_status,
      event: e && { id: e.id, title: e.title, location: e.location, modality: e.modality, sessions: e.sessions, workloadHours: e.workloadHours, phase: e.phase },
    };
  });

  app.get<{ Params: { token: string } }>('/registrations/:token/qr.svg', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const r = await getByToken(req.params.token);
    if (!r || r.status !== 'confirmada') throw notFound('Inscrição não localizada.');
    return reply.header('Cache-Control', 'no-store').type('image/svg+xml').send(await qrSvg(qrContent(req.params.token)));
  });

  app.get<{ Params: { code: string } }>('/certificates/:code', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const c = await findByCode(req.params.code);
    if (!c) throw notFound('Nenhum certificado encontrado com este código.');
    const s = await getSettings();
    return {
      status: c.status,
      number: c.number,
      verificationCode: c.verification_code,
      participantName: c.snapshot.participantName,
      eventTitle: c.snapshot.eventTitle,
      period: c.snapshot.period,
      hours: fmtHours(Number(c.hours)),
      issuedAt: c.issued_at,
      invalidatedAt: c.invalidated_at,
      replacedByCode: c.replaced_by_code,
      department: c.snapshot.department,
      timezone: s.timezone,
    };
  });

  app.get<{ Params: { code: string } }>('/certificates/:code/pdf', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const c = await findByCode(req.params.code);
    if (!c || c.status !== 'valido') throw notFound('Certificado válido não encontrado.');
    const pdf = await renderCertificatePdf(c, await getSettings());
    return reply.type('application/pdf').header('Content-Disposition', `inline; filename="certificado-${c.number}.pdf"`).send(pdf);
  });
}
