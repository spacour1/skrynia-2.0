import { env } from "../config/env.js";
import { logger } from "./logger.js";

const TWILIO_VERIFY_BASE_URL = "https://verify.twilio.com/v2";
const TWILIO_TIMEOUT_MS = 10_000;

function twilioConfigured() {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID);
}

function authHeader() {
  const credentials = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
  return `Basic ${credentials}`;
}

async function twilioRequest(path: string, body: URLSearchParams) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TWILIO_TIMEOUT_MS);
  try {
    return await fetch(`${TWILIO_VERIFY_BASE_URL}/Services/${env.TWILIO_VERIFY_SERVICE_SID}${path}`, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * In dev/test, Twilio is usually unconfigured: rather than fail the request, this logs and
 * no-ops, mirroring common/mailer.ts's treatment of an unconfigured Resend. Callers should
 * check the return value rather than assuming a code was actually sent.
 */
export async function sendPhoneVerificationCode(phone: string): Promise<boolean> {
  if (!twilioConfigured()) {
    logger.warn({ phone }, "phone_code_not_sent_twilio_unconfigured");
    return false;
  }
  const response = await twilioRequest("/Verifications", new URLSearchParams({ To: phone, Channel: "sms" }));
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Twilio Verify responded ${response.status}: ${body}`);
  }
  return true;
}

/** Returns whether the submitted code matches the pending verification for that phone number. */
export async function checkPhoneVerificationCode(phone: string, code: string): Promise<boolean> {
  if (!twilioConfigured()) return false;
  const response = await twilioRequest("/VerificationCheck", new URLSearchParams({ To: phone, Code: code }));
  if (response.status === 404) return false; // no pending verification for this number (expired or never sent)
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Twilio Verify check responded ${response.status}: ${body}`);
  }
  const data = (await response.json()) as { status?: string };
  return data.status === "approved";
}
