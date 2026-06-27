import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined
    });
  }
  return transporter;
}

/**
 * In dev/test, SMTP is usually unconfigured: rather than fail registration or password
 * reset over a missing mail server, this logs the email and no-ops. Production env
 * validation (config/env.ts) requires SMTP_HOST, so this silent path never happens there.
 */
export async function sendEmail(input: { to: string; subject: string; html: string; text: string }) {
  const client = getTransporter();
  if (!client) {
    logger.warn({ to: input.to, subject: input.subject }, "email_not_sent_smtp_unconfigured");
    return;
  }
  await client.sendMail({ from: env.SMTP_FROM, to: input.to, subject: input.subject, html: input.html, text: input.text });
}
