// Processo separado para a fila (opcional): use com WORKER_INLINE=false no servidor web.
import pino from 'pino';
import { getPool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { startEmailWorker } from './services/email-queue.js';
import { runMaintenance } from './services/maintenance.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });
await migrate(getPool(), (m) => log.info(m));
startEmailWorker({ info: (m) => log.info(m), error: (o, m) => log.error(o, m) });
const run = () => runMaintenance().then((r) => log.info({ descarte: r }, 'rotina de retenção')).catch((e) => log.error(e));
setInterval(run, 24 * 3600 * 1000);
setTimeout(run, 60_000);
