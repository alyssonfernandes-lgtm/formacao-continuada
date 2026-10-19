import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePerm, requireUser, uuidParam } from '../http.js';
import { forbidden } from '../lib/errors.js';
import { can } from '../../shared/types.js';
import { listAdminEvents } from '../services/events.js';
import { canOperateEvent, checkin, checkinWindowOpen, searchForCheckin, sessionStats } from '../services/checkin.js';

export async function checkinRoutes(app: FastifyInstance) {
  const guard = requirePerm('checkin.any', 'checkin.assigned');

  app.get('/events', { preHandler: guard }, async (req) => {
    const u = requireUser(req);
    const events = can(u.role, 'checkin.any') ? await listAdminEvents() : await listAdminEvents({ userId: u.id });
    const out = [];
    for (const e of events.filter((x) => x.status === 'publicado')) {
      const sessions = [];
      for (const s of e.sessions) sessions.push({ ...s, open: await checkinWindowOpen({ starts_at: new Date(s.startsAt), ends_at: new Date(s.endsAt) }) });
      out.push({ id: e.id, title: e.title, location: e.location, phase: e.phase, sessions });
    }
    return out;
  });

  app.post('/', { preHandler: guard, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const v = z
      .object({ eventId: z.string().uuid(), sessionId: z.string().uuid(), raw: z.string().max(500).optional(), registrationId: z.string().uuid().optional() })
      .parse(req.body);
    return checkin(requireUser(req), v);
  });

  app.get<{ Querystring: { eventId: string; sessionId: string; q: string } }>('/search', { preHandler: guard, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const eventId = uuidParam(req.query.eventId);
    if (!(await canOperateEvent(requireUser(req), eventId))) throw forbidden('Você não está autorizado a credenciar este evento.');
    return searchForCheckin(eventId, uuidParam(req.query.sessionId), String(req.query.q ?? '').slice(0, 100));
  });

  app.get<{ Querystring: { eventId: string; sessionId: string } }>('/stats', { preHandler: guard }, async (req) => {
    const eventId = uuidParam(req.query.eventId);
    if (!(await canOperateEvent(requireUser(req), eventId))) throw forbidden('Você não está autorizado a credenciar este evento.');
    return sessionStats(uuidParam(req.query.sessionId));
  });
}
