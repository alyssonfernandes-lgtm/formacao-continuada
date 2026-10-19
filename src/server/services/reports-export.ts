import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { decrypt } from '../lib/crypto.js';
import { fmtDate, fmtDateTime } from '../lib/time.js';
import { formatCpf, formatPhone } from '../../shared/validation.js';
import { baseQuery, filterSchema, indicators, INDICATOR_DEFINITIONS, type ReportFilters } from './reports.js';
import { getLogo, getSettings, type Settings } from './settings.js';

const PRESENCE: Record<string, string> = { presente: 'Presente', ausente: 'Ausente', aguardando: 'Aguardando', cancelada: 'Cancelada' };
const CERT: Record<string, string> = { emitido: 'Emitido', pendente: 'Pendente', nao_elegivel: 'Não elegível' };
const REG: Record<string, string> = { confirmada: 'Confirmada', cancelada: 'Cancelada' };

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Field {
  key: string;
  label: string;
  personal?: boolean; // CPF, e-mail, telefone: só no relatório detalhado
  width?: number;
  get: (r: Row, s: Settings) => string | number;
}

/** Catálogo de campos para listas de inscritos: o usuário escolhe quais incluir conforme a exigência do órgão. */
export const REGISTRATION_FIELDS: Field[] = [
  { key: 'protocolo', label: 'Protocolo', width: 1.1, get: (r) => r.protocol },
  { key: 'nome', label: 'Nome', width: 2.2, get: (r) => r.full_name },
  { key: 'cpf', label: 'CPF', personal: true, width: 1.1, get: (r) => formatCpf(decrypt(r.cpf_enc)) },
  { key: 'cpf_mascarado', label: 'CPF (mascarado)', width: 1.1, get: (r) => r.cpf_masked },
  { key: 'email', label: 'E-mail', personal: true, width: 2, get: (r) => r.email },
  { key: 'telefone', label: 'Telefone', personal: true, width: 1.1, get: (r) => formatPhone(r.phone) },
  { key: 'escola', label: 'Escola/instituição', width: 2, get: (r) => r.school ?? '' },
  { key: 'unidade', label: 'Unidade administrativa', width: 1.3, get: (r) => r.unit ?? '' },
  { key: 'evento', label: 'Evento', width: 2, get: (r) => r.event_title },
  { key: 'data_evento', label: 'Data do evento', width: 0.9, get: (r, s) => (r.first_start ? fmtDate(r.first_start, s.timezone) : '') },
  { key: 'situacao_inscricao', label: 'Inscrição', width: 0.9, get: (r) => REG[r.registration_status] },
  { key: 'data_inscricao', label: 'Inscrito em', width: 1.1, get: (r, s) => fmtDateTime(r.registered_at, s.timezone) },
  { key: 'sessoes', label: 'Sessões presentes', width: 0.8, get: (r) => `${r.attended_sessions}/${r.total_sessions}` },
  { key: 'frequencia', label: 'Frequência (%)', width: 0.8, get: (r) => Number(r.attendance_percent) },
  { key: 'situacao_presenca', label: 'Presença', width: 0.9, get: (r) => PRESENCE[r.presence_status] },
  { key: 'situacao_certificado', label: 'Certificado', width: 0.9, get: (r) => CERT[r.certificate_status] },
  { key: 'numero_certificado', label: 'Nº certificado', width: 1, get: (r) => r.certificate_number ?? '' },
  { key: 'carga_certificada', label: 'Carga certificada (h)', width: 0.9, get: (r) => (r.certificate_hours != null ? Number(r.certificate_hours) : '') },
  { key: 'assinatura', label: 'Assinatura', width: 1.6, get: () => '' },
];

export const exportSchema = z.object({
  kind: z.enum(['inscritos', 'presencas', 'certificados', 'resumo']),
  format: z.enum(['csv', 'xlsx', 'pdf']),
  detailed: z.coerce.boolean().default(false),
  fields: z.array(z.string()).optional(),
  title: z.string().max(200).optional(),
  signature: z.coerce.boolean().default(false),
  filters: filterSchema.default({}),
});
export type ExportRequest = z.infer<typeof exportSchema>;

interface Table {
  title: string;
  columns: { label: string; width: number }[];
  rows: (string | number)[][];
}

function criteriaText(f: ReportFilters, names: { event?: string; school?: string }) {
  const parts: string[] = [];
  if (names.event) parts.push(`Evento: ${names.event}`);
  if (f.from || f.to) parts.push(`Período: ${f.from ? f.from.split('-').reverse().join('/') : '...'} a ${f.to ? f.to.split('-').reverse().join('/') : '...'}`);
  if (names.school) parts.push(`Escola: ${names.school}`);
  if (f.unit) parts.push(`Unidade: ${f.unit}`);
  if (f.registrationStatus) parts.push(`Inscrição: ${REG[f.registrationStatus]}`);
  if (f.presenceStatus) parts.push(`Presença: ${PRESENCE[f.presenceStatus]}`);
  if (f.certificateStatus) parts.push(`Certificado: ${CERT[f.certificateStatus]}`);
  return parts.length ? parts.join(' · ') : 'Sem filtros (todos os eventos publicados)';
}

async function filterNames(f: ReportFilters) {
  const db = getPool();
  const event = f.eventId ? (await db.query(`SELECT title FROM events WHERE id = $1`, [f.eventId])).rows[0]?.title : undefined;
  const school = f.schoolId ? (await db.query(`SELECT name FROM schools WHERE id = $1`, [f.schoolId])).rows[0]?.name : undefined;
  return { event, school };
}

export async function buildTables(req: ExportRequest): Promise<{ tables: Table[]; containsPersonal: boolean; rowCount: number }> {
  const s = await getSettings();
  const f = req.filters;
  if (req.kind === 'resumo') {
    const ind = await indicators(f);
    const t = ind.totals;
    const labels: Record<string, string> = {
      totalRegistrations: 'Total de inscrições', confirmed: 'Inscrições confirmadas', cancelled: 'Inscrições canceladas', present: 'Presentes',
      absent: 'Ausentes', awaiting: 'Aguardando início', attendanceRate: 'Taxa de comparecimento (%)', uniqueParticipants: 'Participantes únicos',
      uniquePresent: 'Participantes únicos presentes', certificatesIssued: 'Certificados emitidos', certificatesPending: 'Certificados pendentes',
      emailsPending: 'E-mails pendentes', emailsFailed: 'E-mails com falha', events: 'Eventos', workloadOffered: 'Carga horária ofertada (h)', certifiedHours: 'Horas certificadas (soma)',
    };
    return {
      containsPersonal: false,
      rowCount: ind.byEvent.length,
      tables: [
        {
          title: 'Indicadores',
          columns: [{ label: 'Indicador', width: 1.6 }, { label: 'Valor', width: 0.6 }, { label: 'Critério', width: 4 }],
          rows: Object.keys(labels).map((k) => [labels[k], (t as Row)[k] ?? '—', (INDICATOR_DEFINITIONS as Row)[k]]),
        },
        {
          title: 'Por evento',
          columns: ['Evento', 'Data', 'Carga (h)', 'Confirmadas', 'Canceladas', 'Presentes', 'Ausentes', 'Certificados', 'Cert. pendentes'].map((l, i) => ({ label: l, width: i === 0 ? 3 : 0.8 })),
          rows: ind.byEvent.map((e: Row) => [e.event_title, e.first_start ? fmtDate(e.first_start, s.timezone) : '', e.workload_hours, e.confirmed, e.cancelled, e.present, e.absent, e.certificates, e.certificates_pending]),
        },
        {
          title: 'Por escola',
          columns: ['Escola/instituição', 'Unidade', 'Confirmadas', 'Presentes', 'Ausentes', 'Pessoas únicas', 'Certificados'].map((l, i) => ({ label: l, width: i === 0 ? 3 : i === 1 ? 1.4 : 0.9 })),
          rows: ind.bySchool.map((e: Row) => [e.school, e.unit ?? '', e.confirmed, e.present, e.absent, e.unique_participants, e.certificates]),
        },
        {
          title: 'Por período (mês da primeira sessão)',
          columns: [{ label: 'Mês', width: 1 }, { label: 'Eventos', width: 1 }, { label: 'Confirmadas', width: 1 }, { label: 'Presentes', width: 1 }],
          rows: ind.byMonth.map((m: Row) => [m.month.split('-').reverse().join('/'), m.events, m.confirmed, m.present]),
        },
      ],
    };
  }

  if (req.kind === 'presencas') {
    const { sql, params } = await baseQuery(f);
    const { rows } = await getPool().query(
      `WITH b AS (${sql})
       SELECT b.event_title, b.full_name, b.protocol, b.school, b.cpf_masked, b.cpf_enc, b.email, es.title AS session_title, es.starts_at,
              a.checked_in_at, a.method, a.justification, a.revoked_at, a.revoke_reason, u.name AS operator
         FROM b JOIN attendances a ON a.registration_id = b.registration_id JOIN event_sessions es ON es.id = a.session_id
         JOIN users u ON u.id = a.checked_in_by
        ORDER BY b.event_title, es.starts_at, b.full_name`,
      params,
    );
    const method: Record<string, string> = { qrcode: 'QR Code', manual: 'Busca manual', correcao: 'Correção' };
    const cols = ['Evento', 'Sessão', 'Nome', 'Protocolo', 'Escola', ...(req.detailed ? ['CPF'] : []), 'Check-in', 'Operador', 'Método', 'Situação', 'Justificativa'];
    return {
      containsPersonal: req.detailed,
      rowCount: rows.length,
      tables: [
        {
          title: 'Registros de presença',
          columns: cols.map((l) => ({ label: l, width: ['Evento', 'Nome', 'Escola', 'Justificativa'].includes(l) ? 1.8 : 1 })),
          rows: rows.map((r: Row) => [
            r.event_title,
            `${r.session_title || 'Sessão'} ${fmtDateTime(r.starts_at, s.timezone)}`,
            r.full_name,
            r.protocol,
            r.school ?? '',
            ...(req.detailed ? [formatCpf(decrypt(r.cpf_enc))] : []),
            fmtDateTime(r.checked_in_at, s.timezone),
            r.operator,
            method[r.method],
            r.revoked_at ? `Anulada: ${r.revoke_reason}` : 'Válida',
            r.justification ?? '',
          ]),
        },
      ],
    };
  }

  if (req.kind === 'certificados') {
    const { sql, params } = await baseQuery(f);
    const { rows } = await getPool().query(
      `WITH b AS (${sql})
       SELECT b.event_title, b.full_name, b.school, b.cpf_masked, c.number, c.verification_code, c.hours, c.issued_at, c.status, c.invalidated_reason,
              (SELECT m.status FROM email_messages m WHERE m.certificate_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS email_status
         FROM b JOIN certificates c ON c.registration_id = b.registration_id
        ORDER BY b.event_title, b.full_name, c.issued_at`,
      params,
    );
    const st: Record<string, string> = { valido: 'Válido', substituido: 'Substituído', revogado: 'Revogado' };
    const em: Record<string, string> = { pendente: 'Pendente', enviando: 'Enviando', enviado: 'Enviado', falhou: 'Falhou' };
    return {
      containsPersonal: false,
      rowCount: rows.length,
      tables: [
        {
          title: 'Relação de certificados',
          columns: ['Evento', 'Nome', 'Escola', 'Número', 'Código de verificação', 'Carga (h)', 'Emitido em', 'Situação', 'E-mail'].map((l) => ({ label: l, width: ['Evento', 'Nome', 'Escola'].includes(l) ? 1.8 : 1 })),
          rows: rows.map((r: Row) => [r.event_title, r.full_name, r.school ?? '', r.number, r.verification_code, Number(r.hours), fmtDate(r.issued_at, s.timezone), st[r.status] + (r.invalidated_reason ? ` (${r.invalidated_reason})` : ''), em[r.email_status] ?? '—']),
        },
      ],
    };
  }

  // inscritos
  const allowed = REGISTRATION_FIELDS.filter((fl) => req.detailed || !fl.personal);
  const def = ['protocolo', 'nome', 'escola', 'evento', 'situacao_inscricao', 'situacao_presenca', 'frequencia', 'situacao_certificado'];
  const chosen = (req.fields?.length ? req.fields : def).map((k) => allowed.find((a) => a.key === k)).filter(Boolean) as Field[];
  const { sql, params } = await baseQuery(f);
  const { rows } = await getPool().query(`${sql} ORDER BY event_title, full_name`, params);
  return {
    containsPersonal: chosen.some((c) => c.personal),
    rowCount: rows.length,
    tables: [{ title: 'Lista de inscritos', columns: chosen.map((c) => ({ label: c.label, width: c.width ?? 1 })), rows: rows.map((r: Row) => chosen.map((c) => c.get(r, s))) }],
  };
}

const csvCell = (v: string | number) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // evita injeção de fórmulas em planilhas
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(tables: Table[]) {
  // ";" e BOM UTF-8: abre corretamente no Excel em português
  const parts = tables.map((t) => [tables.length > 1 ? csvCell(t.title) : null, t.columns.map((c) => csvCell(c.label)).join(';'), ...t.rows.map((r) => r.map(csvCell).join(';'))].filter((x) => x !== null).join('\r\n'));
  return Buffer.from('﻿' + parts.join('\r\n\r\n') + '\r\n', 'utf8');
}

export async function toXlsx(tables: Table[], meta: { title: string; criteria: string; generated: string; institution: string }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.institution;
  wb.created = new Date();
  for (const t of tables) {
    const ws = wb.addWorksheet(t.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ''));
    ws.addRow([meta.institution]).font = { bold: true };
    ws.addRow([`${meta.title} — ${t.title}`]).font = { bold: true, size: 13 };
    ws.addRow([`Critérios: ${meta.criteria}`]);
    ws.addRow([`Gerado em: ${meta.generated}`]);
    ws.addRow([]);
    const header = ws.addRow(t.columns.map((c) => c.label));
    header.font = { bold: true };
    header.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    });
    for (const r of t.rows) ws.addRow(r.map((v) => (typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : v)));
    t.columns.forEach((c, i) => (ws.getColumn(i + 1).width = Math.max(10, Math.round(c.width * 16))));
    ws.views = [{ state: 'frozen', ySplit: 6 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function toPdf(tables: Table[], meta: { title: string; criteria: string; generated: string; signature: boolean; containsPersonal: boolean }) {
  const s = await getSettings();
  const logo = await getLogo();
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true, info: { Title: meta.title, Author: s.department } });
  const W = doc.page.width - 72;
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  const header = () => {
    let x = 36;
    if (logo && /png|jpe?g/.test(logo.mime)) {
      try {
        doc.image(logo.data, 36, 28, { fit: [90, 36] });
        x = 136;
      } catch {
        /* sem logo */
      }
    }
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11).text([s.municipality, s.department].filter(Boolean).join(' — '), x, 30, { width: W - (x - 36) });
    doc.font('Helvetica').fontSize(9).fillColor('#475569').text(s.platformName, x, doc.y, { width: W - (x - 36) });
    doc.moveTo(36, 70).lineTo(36 + W, 70).strokeColor(s.primaryColor).lineWidth(1.5).stroke();
    doc.y = 80;
  };
  header();
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(15).text(meta.title, 36, doc.y);
  doc.font('Helvetica').fontSize(9).fillColor('#334155').text(`Critérios: ${meta.criteria}`).text(`Gerado em: ${meta.generated}`);
  if (meta.containsPersonal) doc.fillColor('#b91c1c').text('Contém dados pessoais: uso restrito à finalidade administrativa (LGPD).');
  doc.moveDown(0.6);

  for (const t of tables) {
    const total = t.columns.reduce((a, c) => a + c.width, 0);
    const widths = t.columns.map((c) => (c.width / total) * W);
    const fs = t.columns.length > 9 ? 7 : 8;
    const drawHeader = () => {
      const y = doc.y;
      const h = Math.max(...t.columns.map((c, i) => doc.font('Helvetica-Bold').fontSize(fs).heightOfString(c.label, { width: widths[i] - 6 }))) + 6;
      doc.rect(36, y, W, h).fill('#e2e8f0');
      let x = 36;
      t.columns.forEach((c, i) => {
        doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(fs).text(c.label, x + 3, y + 3, { width: widths[i] - 6 });
        x += widths[i];
      });
      doc.y = y + h;
    };
    if (doc.y > doc.page.height - 120) {
      doc.addPage();
      header();
    }
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11).text(t.title, 36, doc.y);
    doc.moveDown(0.3);
    drawHeader();
    if (!t.rows.length) doc.font('Helvetica').fontSize(fs).fillColor('#475569').text('Nenhum registro para os critérios informados.', 39, doc.y + 4);
    t.rows.forEach((r, ri) => {
      const h = Math.max(...r.map((v, i) => doc.font('Helvetica').fontSize(fs).heightOfString(String(v ?? ''), { width: widths[i] - 6 }))) + (t.columns.some((c) => c.label === 'Assinatura') ? 14 : 6);
      if (doc.y + h > doc.page.height - 50) {
        doc.addPage();
        header();
        drawHeader();
      }
      const y = doc.y;
      if (ri % 2) doc.rect(36, y, W, h).fill('#f8fafc');
      let x = 36;
      r.forEach((v, i) => {
        doc.fillColor('#0f172a').font('Helvetica').fontSize(fs).text(String(v ?? ''), x + 3, y + 3, { width: widths[i] - 6 });
        x += widths[i];
      });
      doc.moveTo(36, y + h).lineTo(36 + W, y + h).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
      doc.y = y + h;
    });
    doc.x = 36;
    doc.moveDown(1);
  }
  doc.font('Helvetica').fontSize(8).fillColor('#475569').text(`Total de linhas: ${tables.map((t) => `${t.title}: ${t.rows.length}`).join(' · ')}`, 36, doc.y, { width: W });

  if (meta.signature) {
    if (doc.y > doc.page.height - 140) {
      doc.addPage();
      header();
    }
    doc.moveDown(3);
    const y = doc.y;
    for (const [i, label] of ['Responsável pela conferência (nome e cargo)', 'Validação institucional / carimbo'].entries()) {
      const x = 36 + i * (W / 2) + 20;
      doc.moveTo(x, y).lineTo(x + W / 2 - 60, y).strokeColor('#64748b').stroke();
      doc.fillColor('#334155').fontSize(9).text(label, x, y + 4, { width: W / 2 - 60, align: 'center' });
    }
    doc.text('Data: ____/____/________', 36, y + 34);
  }

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // O rodapé fica abaixo da margem inferior; zerar a margem evita que o pdfkit crie uma página nova.
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(`Página ${i + 1} de ${range.count}`, 36, doc.page.height - 28, { width: W, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}

export async function runExport(req: ExportRequest) {
  const s = await getSettings();
  const { tables, containsPersonal, rowCount } = await buildTables(req);
  const names = await filterNames(req.filters);
  const titles = { inscritos: 'Lista de inscritos', presencas: 'Lista de presença', certificados: 'Relação de certificados', resumo: 'Resumo consolidado' };
  const meta = {
    title: req.title?.trim() || titles[req.kind],
    criteria: criteriaText(req.filters, names) + (req.detailed ? ' · Versão detalhada' : ' · Versão resumida'),
    generated: fmtDateTime(new Date(), s.timezone) + ` (${s.timezone})`,
    institution: [s.municipality, s.department].filter(Boolean).join(' — '),
  };
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `${req.kind}-${stamp}.${req.format}`;
  if (req.format === 'csv') return { name, mime: 'text/csv; charset=utf-8', body: toCsv(tables), containsPersonal, rowCount };
  if (req.format === 'xlsx') return { name, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: await toXlsx(tables, meta), containsPersonal, rowCount };
  return { name, mime: 'application/pdf', body: await toPdf(tables, { ...meta, signature: req.signature, containsPersonal }), containsPersonal, rowCount };
}
