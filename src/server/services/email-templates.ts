import type { Settings } from './settings.js';

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** Layout responsivo em tabelas (compatível com os principais clientes de e-mail). */
export function layout(s: Settings, publicUrl: string, title: string, bodyHtml: string) {
  const logo = s.hasLogo
    ? `<img src="${esc(publicUrl)}/api/public/logo?v=${esc(s.logoVersion)}" alt="${esc(s.department)}" height="56" style="display:block;max-height:56px;border:0">`
    : '';
  const contact = [s.contactEmail && `E-mail: ${esc(s.contactEmail)}`, s.contactPhone && `Telefone: ${esc(s.contactPhone)}`, s.contactAddress && esc(s.contactAddress)]
    .filter(Boolean)
    .join('<br>');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:${esc(s.primaryColor)};padding:20px 24px;color:#ffffff">
${logo}
<div style="font-size:13px;opacity:.9;margin-top:${logo ? '12px' : '0'}">${esc(s.department)}${s.municipality ? ` · ${esc(s.municipality)}` : ''}</div>
<div style="font-size:20px;font-weight:bold;margin-top:4px">${esc(s.platformName)}</div>
</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55">${bodyHtml}</td></tr>
<tr><td style="padding:16px 24px;background:#f8fafc;font-size:12px;color:#475569;line-height:1.5">
${contact ? `<strong>Contato para correção de informações</strong><br>${contact}<br><br>` : ''}
Mensagem automática. Seus dados são tratados conforme o aviso de privacidade: <a href="${esc(publicUrl)}/privacidade" style="color:#475569">${esc(publicUrl)}/privacidade</a>
</td></tr></table></td></tr></table></body></html>`;
}

export const button = (href: string, label: string, color: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0"><tr><td style="background:${esc(color)};border-radius:6px">
<a href="${esc(href)}" style="display:inline-block;padding:12px 20px;color:#ffffff;text-decoration:none;font-weight:bold">${esc(label)}</a></td></tr></table>`;

export const row = (label: string, value: string) =>
  `<tr><td style="padding:6px 12px 6px 0;color:#475569;vertical-align:top;white-space:nowrap">${esc(label)}</td><td style="padding:6px 0;font-weight:bold">${value}</td></tr>`;
