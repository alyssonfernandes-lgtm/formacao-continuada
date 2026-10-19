import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import argon2 from 'argon2';
import { loadConfig } from '../config.js';
import { getPool } from '../db/pool.js';
import { consumePasswordReset, createPasswordReset, destroySession, hashPassword, login, SESSION_COOKIE } from '../services/auth.js';
import { enqueueEmail } from '../services/email-queue.js';
import { encrypt } from '../lib/crypto.js';
import { audit } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { requireUser } from '../http.js';
import { passwordSchema } from '../../shared/validation.js';
import { ROLE_PERMISSIONS } from '../../shared/types.js';

function setSessionCookie(reply: FastifyReply, token: string) {
  const cfg = loadConfig();
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cfg.PUBLIC_URL.startsWith('https://'),
    sameSite: 'strict',
    path: '/api',
    maxAge: cfg.SESSION_TTL_HOURS * 3600,
  });
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z.object({ email: z.string().max(254), password: z.string().max(200) }).parse(req.body);
    const r = await login(body.email, body.password, { ip: req.ip, userAgent: req.headers['user-agent'] });
    if (!r.ok) {
      await audit(getPool(), { userId: null, action: 'login.falha', details: { motivo: r.reason }, ip: req.ip });
      if (r.reason === 'locked') throw new AppError(423, 'bloqueado', 'Acesso temporariamente bloqueado por excesso de tentativas. Tente novamente em alguns minutos ou redefina a senha.');
      throw new AppError(401, 'credenciais_invalidas', 'E-mail ou senha incorretos.');
    }
    await audit(getPool(), { userId: r.user.id, action: 'login.sucesso', ip: req.ip });
    setSessionCookie(reply, r.token);
    return { user: { id: r.user.id, name: r.user.name, email: r.user.email, role: r.user.role }, csrfToken: r.user.csrfToken, permissions: ROLE_PERMISSIONS[r.user.role] };
  });

  app.post('/logout', async (req, reply) => {
    if (req.user) {
      await destroySession(req.user.sessionId);
      await audit(getPool(), { userId: req.user.id, action: 'logout', ip: req.ip });
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/api' });
    return { ok: true };
  });

  app.get('/me', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!req.user) return { user: null };
    const u = req.user;
    return { user: { id: u.id, name: u.name, email: u.email, role: u.role }, csrfToken: u.csrfToken, permissions: ROLE_PERMISSIONS[u.role] };
  });

  app.post('/forgot', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req) => {
    const { email } = z.object({ email: z.string().email().max(254) }).parse(req.body);
    const r = await createPasswordReset(getPool(), email);
    if (r) {
      await enqueueEmail(getPool(), { kind: 'redefinir_senha', to: r.user.email, userId: r.user.id, payload: { tokenEnc: encrypt(r.token).toString('base64') } });
      await audit(getPool(), { userId: r.user.id, action: 'senha.solicitar_redefinicao', ip: req.ip });
    }
    return { message: 'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.' };
  });

  app.post('/reset', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req) => {
    const { token, password } = z.object({ token: z.string().min(20).max(100), password: passwordSchema }).parse(req.body);
    const userId = await consumePasswordReset(getPool(), token, password);
    if (!userId) throw new AppError(400, 'token_invalido', 'Link inválido ou expirado. Solicite uma nova redefinição.');
    await audit(getPool(), { userId, action: 'senha.redefinir', ip: req.ip });
    return { ok: true };
  });

  app.post('/change-password', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const u = requireUser(req);
    const { current, password } = z.object({ current: z.string().max(200), password: passwordSchema }).parse(req.body);
    const { rows } = await getPool().query(`SELECT password_hash FROM users WHERE id = $1`, [u.id]);
    if (!(await argon2.verify(rows[0].password_hash, current).catch(() => false))) throw new AppError(400, 'senha_atual', 'Senha atual incorreta.');
    await getPool().query(`UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1`, [u.id, await hashPassword(password)]);
    await getPool().query(`DELETE FROM user_sessions WHERE user_id = $1`, [u.id]);
    await audit(getPool(), { userId: u.id, action: 'senha.alterar', ip: req.ip });
    reply.clearCookie(SESSION_COOKIE, { path: '/api' });
    return { ok: true };
  });
}
