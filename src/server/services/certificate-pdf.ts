import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { loadConfig } from '../config.js';
import { fmtHours, fmtLongDate } from '../lib/time.js';
import { getLogo, type Settings } from './settings.js';

export interface CertificateSnapshot {
  participantName: string;
  cpfMasked: string | null;
  eventTitle: string;
  period: string;
  location: string;
  modality: string;
  promoter: string;
  signerName: string;
  signerRole: string;
  department: string;
  municipality: string;
}

function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

export async function renderCertificatePdf(
  c: { number: string; verification_code: string; hours: number | string; issued_at: Date; snapshot: CertificateSnapshot; status: string },
  s: Settings,
) {
  const snap = c.snapshot;
  const verifyUrl = `${loadConfig().PUBLIC_URL.replace(/\/$/, '')}/verificar/${c.verification_code}`;
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 0,
    info: { Title: `Certificado ${c.number}`, Author: snap.department, Subject: snap.eventTitle, CreationDate: new Date(c.issued_at) },
  });
  const W = doc.page.width; // 841.89
  const H = doc.page.height; // 595.28
  const primary = s.primaryColor;
  const secondary = s.secondaryColor;

  // Moldura institucional
  doc.rect(0, 0, W, 14).fill(primary);
  doc.rect(0, H - 14, W, 14).fill(primary);
  doc.lineWidth(1).strokeColor(secondary).rect(28, 34, W - 56, H - 68).stroke();

  let y = 56;
  let logoDrawn = false;
  const logo = await getLogo();
  if (logo && /png|jpe?g/.test(logo.mime)) {
    try {
      doc.image(logo.data, W / 2 - 160, y, { fit: [320, 96], align: 'center', valign: 'center' });
      y += 104;
      logoDrawn = true;
    } catch {
      /* imagem inválida: segue sem logo */
    }
  }
  doc.fillColor('#334155').font('Helvetica').fontSize(11);
  const header = [snap.municipality, snap.department].filter(Boolean).join(' — ');
  // Com logotipo, o nome da instituição já está na imagem
  if (logoDrawn) y -= 14;
  else doc.text(header, 60, y, { width: W - 120, align: 'center' });
  y += 26;
  doc.fillColor(primary).font('Helvetica-Bold').fontSize(34).text('CERTIFICADO', 60, y, { width: W - 120, align: 'center', characterSpacing: 4 });
  y += 54;

  doc.fillColor('#0f172a').font('Helvetica').fontSize(14).text(`${snap.department} certifica que`, 80, y, { width: W - 160, align: 'center' });
  y += 28;
  doc.font('Helvetica-Bold').fontSize(24).text(snap.participantName, 80, y, { width: W - 160, align: 'center' });
  y = doc.y + 4;
  if (snap.cpfMasked) {
    doc.font('Helvetica').fontSize(11).fillColor('#475569').text(`CPF ${snap.cpfMasked}`, 80, y, { width: W - 160, align: 'center' });
    y = doc.y + 10;
  } else y += 10;

  const local = snap.modality === 'On-line' ? 'na modalidade on-line' : `em ${snap.location} (${snap.modality.toLowerCase()})`;
  doc
    .fillColor('#0f172a')
    .font('Helvetica')
    .fontSize(14)
    .text(`participou do evento de formação continuada "${snap.eventTitle}", realizado em ${snap.period}, ${local}, com carga horária certificada de ${fmtHours(Number(c.hours))}.`, 90, y, {
      width: W - 180,
      align: 'center',
      lineGap: 4,
    });
  y = doc.y + 8;
  if (snap.promoter) {
    doc.fontSize(11).fillColor('#475569').text(`Promoção: ${snap.promoter}`, 90, y, { width: W - 180, align: 'center' });
    y = doc.y;
  }
  doc.fontSize(11).fillColor('#475569').text(`Emitido em ${fmtLongDate(c.issued_at, s.timezone)}.`, 90, y + 6, { width: W - 180, align: 'center' });

  // Responsável pela emissão, somente quando informado no evento (nenhuma assinatura é inventada)
  if (snap.signerName) {
    const sy = H - 165;
    doc.strokeColor('#94a3b8').moveTo(W / 2 - 140, sy).lineTo(W / 2 + 140, sy).stroke();
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12).text(snap.signerName, W / 2 - 200, sy + 6, { width: 400, align: 'center' });
    if (snap.signerRole) doc.font('Helvetica').fontSize(10).fillColor('#475569').text(snap.signerRole, W / 2 - 200, doc.y + 1, { width: 400, align: 'center' });
  }

  // Bloco de autenticidade
  const qr = await QRCode.toBuffer(verifyUrl, { type: 'png', margin: 1, width: 240, errorCorrectionLevel: 'M' });
  doc.image(qr, 52, H - 136, { width: 80 });
  doc.fillColor('#334155').font('Helvetica-Bold').fontSize(9).text(`Certificado nº ${c.number}`, 142, H - 128);
  doc.font('Helvetica').text(`Código de verificação: ${c.verification_code}`, 142, H - 114);
  doc.text(`Verifique a autenticidade em: ${verifyUrl}`, 142, H - 100, { width: 420 });
  doc.text(`Documento emitido eletronicamente por ${s.platformName}.`, 142, H - 74, { width: 420 });
  if (c.status !== 'valido') {
    doc.save().rotate(-20, { origin: [W / 2, H / 2] }).fontSize(70).fillColor('#dc2626').fillOpacity(0.25).text(c.status === 'revogado' ? 'REVOGADO' : 'SUBSTITUÍDO', 0, H / 2 - 40, { width: W, align: 'center' }).restore();
  }
  return toBuffer(doc);
}
