import { getPool, type Db } from '../db/pool.js';
import { loadConfig, smtpConfigured } from '../config.js';
import { getTransport } from './mailer.js';
import { getSettings } from './settings.js';
import { buildEmail } from './email-builders.js';

export type EmailKind = 'confirmacao' | 'certificado' | 'redefinir_senha';

export async function enqueueEmail(
  db: Db,
  m: { kind: EmailKind; to: string; registrationId?: string; certificateId?: string; userId?: string; payload?: Record<string, unknown>; ignoreIfInflight?: boolean; createdBy?: string },
) {
  // Os índices únicos parciais impedem dois envios simultâneos da mesma confirmação ou do mesmo certificado
  const { rows } = await db.query(
    `INSERT INTO email_messages(kind, to_address, registration_id, certificate_id, user_id, payload, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING RETURNING id`,
    [m.kind, m.to, m.registrationId ?? null, m.certificateId ?? null, m.userId ?? null, m.payload ?? {}, m.createdBy ?? null],
  );
  return (rows[0]?.id as string | undefined) ?? null;
}

const backoffMinutes = (attempt: number) => Math.min(2 ** (attempt - 1), 60);

/** Processa um lote da fila. Retorna quantas mensagens foram tentadas. */
export async function processEmailQueue(limit = 10): Promise<number> {
  const cfg = loadConfig();
  if (!smtpConfigured(cfg)) return 0;
  const db = getPool();
  // Recupera mensagens presas em "enviando" por queda do processo
  await db.query(`UPDATE email_messages SET status = 'pendente', locked_at = NULL WHERE status = 'enviando' AND locked_at < now() - interval '10 minutes'`);
  const { rows } = await db.query(
    `UPDATE email_messages SET status = 'enviando', locked_at = now(), attempts = attempts + 1
      WHERE id IN (SELECT id FROM email_messages WHERE status = 'pendente' AND next_attempt_at <= now()
                    ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [limit],
  );
  const transport = getTransport()!;
  const settings = await getSettings();
  for (const m of rows) {
    try {
      const mail = await buildEmail(m, settings);
      if (!mail) {
        await db.query(`UPDATE email_messages SET status = 'falhou', last_error = $2, locked_at = NULL WHERE id = $1`, [m.id, 'Registro de origem indisponível (cancelado ou substituído).']);
        continue;
      }
      const info = await transport.sendMail({ from: cfg.SMTP_FROM, to: m.to_address, ...mail });
      const accepted = (info.accepted ?? []).map(String).map((a) => a.toLowerCase());
      if (!accepted.includes(String(m.to_address).toLowerCase())) {
        throw new Error(`Servidor SMTP não aceitou o destinatário (${(info.rejected ?? []).length} recusado)`);
      }
      await db.query(
        `UPDATE email_messages SET status = 'enviado', sent_at = now(), provider_message_id = $2, last_error = NULL, locked_at = NULL WHERE id = $1`,
        [m.id, String(info.messageId ?? '').slice(0, 300)],
      );
    } catch (err) {
      const msg = String((err as Error).message ?? err).replace(/[\r\n]+/g, ' ').slice(0, 500);
      const final = m.attempts >= m.max_attempts;
      await db.query(
        `UPDATE email_messages SET status = $2, last_error = $3, locked_at = NULL,
            next_attempt_at = now() + ($4 || ' minutes')::interval WHERE id = $1`,
        [m.id, final ? 'falhou' : 'pendente', msg, String(backoffMinutes(m.attempts))],
      );
    }
  }
  return rows.length;
}

/** Nova tentativa manual de uma mensagem que falhou (não cria certificado nem inscrição novos). */
export async function retryEmail(db: Db, id: string) {
  const r = await db.query(
    `UPDATE email_messages SET status = 'pendente', attempts = 0, next_attempt_at = now(), last_error = coalesce(last_error, '') WHERE id = $1 AND status = 'falhou' RETURNING id`,
    [id],
  );
  return Boolean(r.rowCount);
}

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startEmailWorker(log: { info: (m: string) => void; error: (o: unknown, m: string) => void }) {
  const cfg = loadConfig();
  if (!smtpConfigured(cfg)) log.info('SMTP não configurado: os e-mails ficarão pendentes até a configuração das variáveis SMTP_*.');
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      while ((await processEmailQueue(10)) === 10) {
        /* continua enquanto houver lote cheio */
      }
    } catch (e) {
      log.error(e, 'Falha ao processar a fila de e-mails');
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, cfg.WORKER_POLL_MS);
  void tick();
}

export function stopEmailWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
