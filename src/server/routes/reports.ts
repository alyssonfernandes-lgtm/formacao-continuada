import type { FastifyInstance } from 'fastify';
import { getPool } from '../db/pool.js';
import { requirePerm, requireUser } from '../http.js';
import { audit } from '../lib/audit.js';
import { forbidden } from '../lib/errors.js';
import { can } from '../../shared/types.js';
import { filterSchema, indicators } from '../services/reports.js';
import { exportSchema, REGISTRATION_FIELDS, runExport } from '../services/reports-export.js';

export async function reportRoutes(app: FastifyInstance) {
  app.get('/indicators', { preHandler: requirePerm('reports.summary') }, async (req) => indicators(filterSchema.parse(req.query)));

  app.get('/fields', { preHandler: requirePerm('reports.summary') }, async (req) => {
    const detailed = can(requireUser(req).role, 'reports.detailed');
    return REGISTRATION_FIELDS.filter((f) => detailed || !f.personal).map((f) => ({ key: f.key, label: f.label, personal: Boolean(f.personal) }));
  });

  app.post('/export', { preHandler: requirePerm('reports.summary'), config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const u = requireUser(req);
    const v = exportSchema.parse(req.body);
    // Consulta gerencial: apenas o resumo consolidado, sem dados individuais
    if (!can(u.role, 'reports.detailed') && (v.kind !== 'resumo' || v.detailed)) throw forbidden('Seu perfil permite exportar apenas o resumo consolidado.');
    const out = await runExport(v);
    await audit(getPool(), {
      userId: u.id,
      action: out.containsPersonal ? 'relatorio.exportar_dados_pessoais' : 'relatorio.exportar',
      details: { tipo: v.kind, formato: v.format, detalhado: v.detailed, campos: v.fields ?? null, filtros: v.filters, linhas: out.rowCount },
      ip: req.ip,
    });
    return reply
      .header('Content-Type', out.mime)
      .header('Content-Disposition', `attachment; filename="${out.name}"`)
      .header('Cache-Control', 'no-store')
      .send(out.body);
  });
}
