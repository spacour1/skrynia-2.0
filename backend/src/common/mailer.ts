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
 * reset over a missing mail server, this logs the email and no-ops. config/env.ts only
 * warns (not fails) when SMTP_HOST is missing in production too, so callers that need to
 * know whether a send actually happened (e.g. the verify-email/request endpoint) should
 * check the return value instead of assuming it always reaches an inbox.
 */
export async function sendEmail(input: { to: string; subject: string; html: string; text: string }): Promise<boolean> {
  const client = getTransporter();
  if (!client) {
    logger.warn({ to: input.to, subject: input.subject }, "email_not_sent_smtp_unconfigured");
    return false;
  }
  await client.sendMail({ from: env.SMTP_FROM, to: input.to, subject: input.subject, html: input.html, text: input.text });
  return true;
}

/**
 * Shared dark/minimalist layout for all transactional emails so verification and
 * password-reset mail look consistent with the SKRYNIA brand (dark background, amber
 * accent button). `bodyHtml` is trusted, pre-built markup — callers must not interpolate
 * unescaped user input into it.
 */
export function renderBrandedEmail(input: { title: string; bodyHtml: string; ctaText: string; ctaUrl: string; footerNote: string }) {
  const safeUrl = encodeURI(input.ctaUrl);
  return `<!doctype html>
<html lang="ru">
  <body style="margin:0;padding:0;background-color:#0b0d12;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0b0d12;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background-color:#13151b;border:1px solid #23262f;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 0 32px;">
                <span style="display:inline-block;font-size:20px;font-weight:800;color:#f6be4e;letter-spacing:0.02em;">SKRYNIA</span>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0 32px;">
                <h1 style="margin:0;font-size:20px;font-weight:800;color:#f5f6f8;">${input.title}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 32px 0 32px;font-size:14px;line-height:22px;color:#aab0bc;">
                ${input.bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0 32px;">
                <a href="${safeUrl}" style="display:inline-block;background-color:#f6be4e;color:#1a1306;font-weight:800;font-size:14px;text-decoration:none;padding:12px 24px;border-radius:10px;">${input.ctaText}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 0 32px;font-size:12px;line-height:18px;color:#6b7280;word-break:break-all;">
                Если кнопка не работает, перейдите по ссылке: <a href="${safeUrl}" style="color:#f6be4e;">${safeUrl}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 28px 32px;font-size:12px;line-height:18px;color:#6b7280;border-top:1px solid #23262f;margin-top:20px;">
                ${input.footerNote}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
