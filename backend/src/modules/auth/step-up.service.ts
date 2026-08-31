import crypto from "node:crypto";
import { pool } from "../../db/pool.js";
import {
  serviceUnavailable,
  unauthorized
} from "../../common/errors.js";
import { getRedis } from "../../common/redis.js";
import { verifyPassword } from "./password.service.js";
import { verifyTwoFactorCode } from "./twofa.service.js";

export const STEP_UP_TTL_SECONDS = 5 * 60;
export type StepUpPurpose = "change_email";

type StepUpRecord = {
  userId: string;
  sessionId: string;
  sessionVersion: number;
  purpose: StepUpPurpose;
};

type StepUpCredential = {
  currentPassword?: string;
  code?: string;
};

const CONSUME_STEP_UP_SCRIPT = `
local record = redis.call("GET", KEYS[1])
if not record or record ~= ARGV[1] then return 0 end
redis.call("DEL", KEYS[1])
return 1
`;

function hashStepUpToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function stepUpKey(token: string) {
  return `step_up:${hashStepUpToken(token)}`;
}

function encodeRecord(record: StepUpRecord) {
  return JSON.stringify(record);
}

async function verifyStepUpCredential(
  userId: string,
  expectedSessionVersion: number,
  credential: StepUpCredential
) {
  const result = await pool.query<{
    passwordHash: string | null;
    twoFactorEnabled: boolean;
    sessionVersion: number;
  }>(
    `select password_hash as "passwordHash",
            two_factor_enabled as "twoFactorEnabled",
            session_version as "sessionVersion"
     from users
     where id = $1`,
    [userId]
  );
  const user = result.rows[0];
  if (!user || user.sessionVersion !== expectedSessionVersion) {
    throw unauthorized("Authentication state changed, log in again");
  }

  if (user.twoFactorEnabled) {
    if (!credential.code || !(await verifyTwoFactorCode(userId, credential.code))) {
      throw unauthorized("Additional authentication failed");
    }
    return;
  }

  if (
    !user.passwordHash ||
    !credential.currentPassword ||
    !(await verifyPassword(credential.currentPassword, user.passwordHash))
  ) {
    // Accounts without either an enabled 2FA method or a password fail closed. In
    // particular, a Telegram-only login cannot turn possession of one session into an
    // identity replacement without first enabling a reauthentication factor.
    throw unauthorized("Additional authentication failed");
  }
}

export async function createStepUpToken(input: StepUpRecord & StepUpCredential) {
  await verifyStepUpCredential(input.userId, input.sessionVersion, input);

  const redis = getRedis();
  if (!redis) {
    throw serviceUnavailable("Additional authentication is temporarily unavailable");
  }

  const record: StepUpRecord = {
    userId: input.userId,
    sessionId: input.sessionId,
    sessionVersion: input.sessionVersion,
    purpose: input.purpose
  };
  try {
    // NX is defense in depth for an astronomically unlikely random-token collision.
    // Retry once with fresh entropy rather than overwriting another proof.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const stepUpToken = crypto.randomBytes(32).toString("base64url");
      const stored = await redis.set(
        stepUpKey(stepUpToken),
        encodeRecord(record),
        "EX",
        STEP_UP_TTL_SECONDS,
        "NX"
      );
      if (stored === "OK") {
        return { stepUpToken, expiresInSeconds: STEP_UP_TTL_SECONDS };
      }
    }
    throw new Error("Step-up token collision retry exhausted");
  } catch {
    throw serviceUnavailable("Additional authentication is temporarily unavailable");
  }
}

export async function consumeStepUpToken(input: StepUpRecord & { stepUpToken: string }) {
  const redis = getRedis();
  if (!redis) {
    throw serviceUnavailable("Additional authentication is temporarily unavailable");
  }

  const expected = encodeRecord({
    userId: input.userId,
    sessionId: input.sessionId,
    sessionVersion: input.sessionVersion,
    purpose: input.purpose
  });
  let consumed: unknown;
  try {
    consumed = await redis.eval(
      CONSUME_STEP_UP_SCRIPT,
      1,
      stepUpKey(input.stepUpToken),
      expected
    );
  } catch {
    throw serviceUnavailable("Additional authentication is temporarily unavailable");
  }
  if (consumed !== 1 && consumed !== "1") {
    throw unauthorized("Step-up token is invalid or expired");
  }
}
