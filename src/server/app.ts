import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { AppError } from './lib/errors.js';
import { resolveSession, SESSION_COOKIE } from './services/auth.js';
import { safeEqual } from './lib/crypto.js';
import { publicRoutes } from './routes/public.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { checkinRoutes } from './routes/checkin.js';
import { reportRoutes } from './routes/reports.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const cfg = loadConfig();
  const app = Fastify({
    trustProxy: cfg.TRUST_PROXY,
    bodyLimit: 3 * 1024 * 1024,
    logger:
      opts.logger === false
        ? false
        : {
            level: cfg.LOG_LEVEL,
            // Minimização: nada de cookies, corpo das requisições ou tokens nos logs
            redact: ['req.headers.cookie', 'req.headers["x-csrf-token"]', 'req.headers.authorization'],
            serializers: {
              req: (r) => ({ method: r.method, url: String(r.url).replace(/\/(i|registrations|redefinir-senha)\/[A-Za-z0-9_-]{20,}/g, '/$1/[token]'), ip: r.ip }),
            },
          },
  });

  app.decorateRequest('user', null);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        upgradeInsecureRequests: cfg.NODE_ENV === 'production' ? [] : null,
      },
    },
    strictTransportSecurity: cfg.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false,
  });
  // A câmera só é liberada para a própria origem
  app.addHook('onSend', async (_req, reply) => {
    reply.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false, keyGenerator: (req) => req.ip });

  const allowedOrigins = new Set([new URL(cfg.PUBLIC_URL).origin]);
  if (cfg.NODE_ENV !== 'production') ['http://localhost:5173', 'http://127.0.0.1:5173'].forEach((o) => allowedOrigins.add(o));

  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    // Proteção contra requisições de outras origens (CSRF), também nas rotas públicas
    if (unsafe) {
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.has(origin)) throw new AppError(403, 'origem_invalida', 'Origem da requisição não permitida.');
    }
    if (req.url.startsWith('/api/admin/') || req.url.startsWith('/api/auth/')) {
      const token = req.cookies[SESSION_COOKIE];
      req.user = token ? await resolveSession(token) : null;
      if (unsafe && req.user && !req.url.startsWith('/api/auth/login')) {
        const h = String(req.headers['x-csrf-token'] ?? '');
        if (!h || !safeEqual(h, req.user.csrfToken)) throw new AppError(403, 'csrf', 'Token de segurança inválido. Recarregue a página.');
      }
    }
    if (req.url.startsWith('/api/admin/') && !req.user) throw new AppError(401, 'nao_autenticado', 'Sua sessão expirou. Entre novamente.');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      const fields: Record<string, string> = {};
      for (const i of err.issues) fields[i.path.join('.') || '_'] ??= i.message;
      return reply.status(400).send({ error: 'validacao', message: 'Confira os campos destacados.', fields });
    }
    if (err instanceof AppError) return reply.status(err.status).send({ error: err.code, message: err.message, ...err.extra });
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode === 429) return reply.status(429).send({ error: 'muitas_tentativas', message: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.' });
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: 'requisicao_invalida', message: 'Requisição inválida.' });
    req.log.error({ err: { message: e.message, code: e.code, stack: (err as Error).stack } }, 'erro interno');
    return reply.status(500).send({ error: 'erro_interno', message: 'Ocorreu um erro interno. Tente novamente; se persistir, contate o suporte.' });
  });

  app.get('/api/health', async () => {
    const { getPool } = await import('./db/pool.js');
    await getPool().query('SELECT 1');
    return { ok: true };
  });

  await app.register(publicRoutes, { prefix: '/api/public' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.register(checkinRoutes, { prefix: '/api/admin/checkin' });
  await app.register(reportRoutes, { prefix: '/api/admin/reports' });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'nao_encontrado', message: 'Recurso não encontrado.' });
    if (webRoot) return reply.type('text/html').sendFile('index.html');
    return reply.status(404).send('Interface não compilada. Execute npm run build ou use npm run dev.');
  });

  // Interface compilada (produção)
  const candidates = [path.resolve(here, '../../web'), path.resolve(here, '../../dist/web'), path.resolve(process.cwd(), 'dist/web')];
  const webRoot = candidates.find((c) => existsSync(path.join(c, 'index.html')));
  if (webRoot) {
    await app.register(fastifyStatic, {
      root: webRoot,
      wildcard: false,
      index: ['index.html'],
      setHeaders: (res, p) => {
        if (p.includes(`${path.sep}assets${path.sep}`)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
        else res.header('Cache-Control', 'no-cache');
      },
    });
  }
  return app;
}
