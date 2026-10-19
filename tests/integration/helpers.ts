import { SMTPServer } from 'smtp-server';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.js';
import { getPool } from '../../src/server/db/pool.js';
import { migrate } from '../../src/server/db/migrate.js';
import { hashPassword } from '../../src/server/services/auth.js';
import { invalidateSettingsCache } from '../../src/server/services/settings.js';
import { resetTransportForTests } from '../../src/server/services/mailer.js';

export async function resetDb() {
  const db = getPool();
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db);
  invalidateSettingsCache();
}

export async function makeApp() {
  const app = await buildApp({ logger: false });
  await app.ready();
  return app;
}

/** Gera CPF válido a partir de um número (9 dígitos base + verificadores). */
export function cpf(n: number) {
  const base = String(100000000 + n).slice(-9).split('').map(Number);
  const dv = (arr: number[]) => {
    const len = arr.length;
    const sum = arr.reduce((a, d, i) => a + d * (len + 1 - i), 0);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  return [...base, d1, d2].join('');
}

const letters = (n: number) => {
  let s = '';
  do {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  } while (n > 0);
  return s[0].toUpperCase() + s.slice(1) + 'son';
};

export async function createUser(email: string, role: string, password = 'SenhaForte12345') {
  const { rows } = await getPool().query(`INSERT INTO users(name, email, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id`, [
    `Usuário ${role}`, email, role, await hashPassword(password),
  ]);
  return rows[0].id as string;
}

type Res = { status: number; json: any; body: string; headers: Record<string, unknown>; raw: Buffer }; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface Client {
  inject: (method: string, url: string, body?: unknown) => Promise<Res>;
}

const randomIp = () => `10.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}`;

async function call(app: FastifyInstance, method: string, url: string, body: unknown, headers: Record<string, string>): Promise<Res> {
  // IP de origem variado: os limites por IP são testados separadamente
  const r = await app.inject({ method: method as 'GET', url, payload: body as object, remoteAddress: headers['x-test-ip'] ?? randomIp(), headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) } });
  let json: unknown = null;
  try {
    json = r.json();
  } catch {
    /* não JSON */
  }
  return { status: r.statusCode, json, body: r.body, headers: r.headers, raw: r.rawPayload };
}

export const anon = (app: FastifyInstance, fixedIp?: string): Client => ({ inject: (m, u, b) => call(app, m, u, b, fixedIp ? { 'x-test-ip': fixedIp } : {}) });

export async function loginAs(app: FastifyInstance, email: string, password = 'SenhaForte12345'): Promise<Client & { csrf: string; cookie: string }> {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password }, remoteAddress: randomIp() });
  if (r.statusCode !== 200) throw new Error(`login falhou: ${r.statusCode} ${r.body}`);
  const cookie = String(r.headers['set-cookie']).split(';')[0];
  const csrf = r.json().csrfToken;
  return { csrf, cookie, inject: (m, u, b) => call(app, m, u, b, { cookie, 'x-csrf-token': csrf }) };
}

export const iso = (minutesFromNow: number) => new Date(Date.now() + minutesFromNow * 60_000).toISOString();

export function eventPayload(over: Record<string, unknown> = {}) {
  return {
    title: 'Formação em Alfabetização',
    description: 'Encontro formativo',
    location: 'Auditório Central',
    modality: 'Presencial',
    workloadHours: 4,
    capacity: null,
    registrationOpensAt: iso(-60 * 24),
    registrationClosesAt: iso(60 * 24),
    status: 'publicado',
    certCriterion: 'todas_sessoes',
    sessions: [{ title: 'Encontro', startsAt: iso(-30), endsAt: iso(210), hours: 4 }],
    ...over,
  };
}

export function registration(n: number, over: Record<string, unknown> = {}) {
  return {
    fullName: `Professora ${letters(n)} da Silva`,
    cpf: cpf(n),
    schoolOther: 'EMEF Teste',
    email: `prof${n}@teste.local`,
    phone: '48999990000',
    privacyAck: true,
    ...over,
  };
}

export interface Mailbox {
  messages: { to: string[]; raw: string }[];
  close: () => Promise<void>;
}

export async function startSmtp(port = 2526, opts: { reject?: boolean } = {}): Promise<Mailbox> {
  const messages: Mailbox['messages'] = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    logger: false,
    onRcptTo(_addr, _s, cb) {
      if (opts.reject) return cb(Object.assign(new Error('Caixa postal inexistente'), { responseCode: 550 }));
      cb();
    },
    onData(stream, session, cb) {
      let raw = '';
      stream.on('data', (c) => (raw += c.toString()));
      stream.on('end', () => {
        messages.push({ to: session.envelope.rcptTo.map((r) => r.address), raw });
        cb();
      });
    },
  });
  await new Promise<void>((res) => server.listen(port, '127.0.0.1', res));
  resetTransportForTests();
  return {
    messages,
    close: () =>
      new Promise((res) => {
        resetTransportForTests();
        server.close(() => res());
      }),
  };
}
