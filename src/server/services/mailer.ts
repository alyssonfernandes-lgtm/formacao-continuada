import nodemailer, { type Transporter } from 'nodemailer';
import { loadConfig, smtpConfigured } from '../config.js';

let transporter: Transporter | null = null;

export function getTransport(): Transporter | null {
  const c = loadConfig();
  if (!smtpConfigured(c)) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: c.SMTP_HOST,
      port: c.SMTP_PORT,
      secure: c.SMTP_SECURE,
      requireTLS: c.SMTP_REQUIRE_TLS,
      auth: c.SMTP_USER ? { user: c.SMTP_USER, pass: c.SMTP_PASS } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
  return transporter;
}

export function resetTransportForTests() {
  transporter?.close();
  transporter = null;
}
