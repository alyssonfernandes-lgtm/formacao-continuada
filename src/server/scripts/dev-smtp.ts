// Caixa postal local para homologação: recebe e-mails por SMTP (porta 2525) e grava cada um em mailbox/*.eml.
// NÃO usar em produção. Uso: npm run dev:smtp
import { SMTPServer } from 'smtp-server';
import { mkdirSync, writeFileSync } from 'node:fs';

const dir = process.env.MAILBOX_DIR ?? 'mailbox';
const port = Number(process.env.DEV_SMTP_PORT ?? 2525);
mkdirSync(dir, { recursive: true });
let n = 0;
new SMTPServer({
  authOptional: true,
  disabledCommands: ['STARTTLS'],
  logger: false,
  onData(stream, session, cb) {
    const chunks: Buffer[] = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => {
      const file = `${dir}/${Date.now()}-${++n}.eml`;
      writeFileSync(file, Buffer.concat(chunks));
      console.log(`e-mail para ${session.envelope.rcptTo.map((r) => r.address).join(', ')} -> ${file}`);
      cb();
    });
  },
}).listen(port, '127.0.0.1', () => console.log(`SMTP de homologação em 127.0.0.1:${port}, gravando em ${dir}/`));
