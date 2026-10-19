import { getPool } from '../db/pool.js';
import { loadConfig } from '../config.js';
import { decrypt } from '../lib/crypto.js';
import { fmtDate, fmtLongDate, fmtTime, fmtHours } from '../lib/time.js';
import type { Settings } from './settings.js';
import { button, esc, layout, row } from './email-templates.js';
import { qrPng, qrContent } from './registrations.js';
import { renderCertificatePdf } from './certificate-pdf.js';

interface Mail {
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: Buffer; contentType: string; cid?: string }[];
}

const base = () => loadConfig().PUBLIC_URL.replace(/\/$/, '');

export async function buildEmail(m: { kind: string; registration_id: string | null; certificate_id: string | null; user_id: string | null; payload: Record<string, unknown> }, s: Settings): Promise<Mail | null> {
  if (m.kind === 'confirmacao') return confirmation(m.registration_id!, s);
  if (m.kind === 'certificado') return certificate(m.certificate_id!, s);
  if (m.kind === 'redefinir_senha') return reset(m.user_id!, String(m.payload.tokenEnc ?? ''), s);
  return null;
}

async function confirmation(registrationId: string, s: Settings): Promise<Mail | null> {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT r.protocol, r.status, r.qr_token_enc, p.full_name, e.title, e.location, e.modality, e.id AS event_id
       FROM registrations r JOIN participants p ON p.id = r.participant_id JOIN events e ON e.id = r.event_id WHERE r.id = $1`,
    [registrationId],
  );
  const r = rows[0];
  if (!r || r.status !== 'confirmada') return null;
  const sessions = (await db.query(`SELECT title, starts_at, ends_at FROM event_sessions WHERE event_id = $1 ORDER BY starts_at`, [r.event_id])).rows;
  const token = decrypt(r.qr_token_enc);
  const link = qrContent(token);
  const tz = s.timezone;
  const when = sessions
    .map((x) => `${fmtDate(x.starts_at, tz)}, ${fmtTime(x.starts_at, tz)} às ${fmtTime(x.ends_at, tz)}${x.title ? ` (${esc(x.title)})` : ''}`)
    .join('<br>');
  const html = layout(
    s,
    base(),
    'Inscrição confirmada',
    `<p style="margin:0 0 12px">Olá, <strong>${esc(r.full_name)}</strong>.</p>
<p style="margin:0 0 16px">Sua inscrição foi confirmada. Guarde este e-mail: o QR Code abaixo será lido no credenciamento.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px">
${row('Evento', esc(r.title))}${row('Data e horário', when)}${row('Local', `${esc(r.location)} (${esc(r.modality)})`)}${row('Protocolo', esc(r.protocol))}
</table>
<div style="text-align:center;margin:20px 0"><img src="cid:qrcode" width="220" height="220" alt="QR Code da inscrição ${esc(r.protocol)}" style="border:1px solid #e2e8f0"></div>
<p style="margin:0 0 8px"><strong>No credenciamento:</strong> apresente este QR Code na tela do celular ou impresso. Ele é pessoal: não o compartilhe.</p>
<p style="margin:0">Se a imagem não aparecer, acesse sua inscrição pelo botão abaixo.</p>
${button(link, 'Abrir minha inscrição', s.primaryColor)}`,
  );
  const text = `Olá, ${r.full_name}.\n\nSua inscrição foi confirmada.\nEvento: ${r.title}\nProtocolo: ${r.protocol}\nLocal: ${r.location}\nAcesse sua inscrição e o QR Code: ${link}\n\nApresente o QR Code no credenciamento.`;
  return {
    subject: `Inscrição confirmada: ${r.title}`,
    html,
    text,
    attachments: [{ filename: `qrcode-${r.protocol}.png`, content: await qrPng(token), contentType: 'image/png', cid: 'qrcode' }],
  };
}

async function certificate(certificateId: string, s: Settings): Promise<Mail | null> {
  const { rows } = await getPool().query(`SELECT * FROM certificates WHERE id = $1`, [certificateId]);
  const c = rows[0];
  if (!c || c.status !== 'valido') return null;
  const snap = c.snapshot;
  const verifyUrl = `${base()}/verificar/${c.verification_code}`;
  const pdf = await renderCertificatePdf(c, s);
  const html = layout(
    s,
    base(),
    'Certificado disponível',
    `<p style="margin:0 0 12px">Olá, <strong>${esc(snap.participantName)}</strong>.</p>
<p style="margin:0 0 16px">Seu certificado de participação está anexado a este e-mail em PDF.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px">
${row('Evento', esc(snap.eventTitle))}${row('Carga horária', esc(fmtHours(Number(c.hours))))}${row('Certificado nº', esc(c.number))}${row('Emitido em', esc(fmtLongDate(c.issued_at, s.timezone)))}
</table>
<p style="margin:16px 0 0">A autenticidade pode ser conferida a qualquer momento pelo endereço de verificação:</p>
${button(verifyUrl, 'Verificar e baixar o certificado', s.primaryColor)}`,
  );
  return {
    subject: `Certificado: ${snap.eventTitle}`,
    html,
    text: `Olá, ${snap.participantName}.\n\nSeu certificado do evento "${snap.eventTitle}" está anexado.\nNúmero: ${c.number}\nVerificação: ${verifyUrl}`,
    attachments: [{ filename: `certificado-${c.number}.pdf`, content: pdf, contentType: 'application/pdf' }],
  };
}

async function reset(userId: string, tokenEnc: string, s: Settings): Promise<Mail | null> {
  const { rows } = await getPool().query(`SELECT name FROM users WHERE id = $1 AND active`, [userId]);
  if (!rows[0] || !tokenEnc) return null;
  const token = decrypt(Buffer.from(tokenEnc, 'base64'));
  const link = `${base()}/admin/redefinir-senha/${token}`;
  return {
    subject: 'Redefinição de senha',
    html: layout(
      s,
      base(),
      'Redefinição de senha',
      `<p>Olá, ${esc(rows[0].name)}.</p><p>Recebemos um pedido para redefinir sua senha de acesso ao painel. O link vale por 1 hora e só pode ser usado uma vez.</p>${button(link, 'Definir nova senha', s.primaryColor)}<p style="font-size:13px;color:#475569">Se você não fez este pedido, ignore esta mensagem; sua senha atual continua válida.</p>`,
    ),
    text: `Para definir nova senha (válido por 1 hora): ${link}`,
  };
}
