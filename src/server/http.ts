import type { FastifyReply, FastifyRequest } from 'fastify';
import { can, type Permission } from '../shared/types.js';
import { AppError } from './lib/errors.js';
import type { SessionUser } from './services/auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new AppError(401, 'nao_autenticado', 'Sua sessão expirou. Entre novamente.');
  return req.user;
}

/** preHandler: exige ao menos uma das permissões. A autorização é sempre decidida aqui, no servidor. */
export const requirePerm =
  (...perms: Permission[]) =>
  async (req: FastifyRequest, _reply: FastifyReply) => {
    const u = requireUser(req);
    if (!perms.some((p) => can(u.role, p))) throw new AppError(403, 'sem_permissao', 'Você não tem permissão para esta ação.');
  };

export const ip = (req: FastifyRequest) => req.ip;

export const uuidParam = (v: unknown) => {
  const s = String(v ?? '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) throw new AppError(404, 'nao_encontrado', 'Registro não encontrado.');
  return s;
};

export const reasonOf = (body: unknown, min = 5) => {
  const r = String((body as { reason?: unknown } | null)?.reason ?? '').trim();
  if (r.length < min) throw new AppError(400, 'justificativa', `Informe a justificativa (mínimo de ${min} caracteres).`);
  return r.slice(0, 1000);
};
