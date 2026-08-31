import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { inTx, pool } from "../../db/pool.js";
import {
  badRequest,
  conflict,
  serviceUnavailable,
  unauthorized
} from "../../common/errors.js";
import { renderBrandedEmail, sendEmail } from "../../common/mailer.js";
import type { Locale } from "../../i18n/config.js";
import { getT } from "../../i18n/t.js";
import { revokeAllUserSessions } from "./session.service.js";
import { consumeStepUpToken } from "./step-up.service.js";

export const EMAIL_CHANGE_TTL_SECONDS = 24 * 60 * 60;

type EmailDelivery = typeof sendEmail;
type SessionRevocation = typeof revokeAllUserSessions;

export type EmailChangeDependencies = {
  sendEmail: EmailDelivery;
  revokeAllUserSessions: SessionRevocation;
  now: () => Date;
  randomToken: () => string;
};

const defaultDependencies: EmailChangeDependencies = {
  sendEmail,
  revokeAllUserSessions,
  now: () => new Date(),
  randomToken: () => crypto.randomBytes(32).toString("base64url")
};

function dependencies(
  overrides: Partial<EmailChangeDependencies> = {}
): EmailChangeDependencies {
  return { ...defaultDependencies, ...overrides };
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function confirmationUrl(locale: Locale, token: string) {
  const base = env.FRONTEND_URL.replace(/\/+$/, "");
  return `${base}/${locale}/verify-email?purpose=email-change&token=${encodeURIComponent(token)}`;
}

function isUniqueViolation(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function deliveryMessages(locale: Locale, link: string) {
  const t = getT(locale);
  return {
    confirmation: {
      subject: t("email.emailChangeConfirm.subject"),
      text: t("email.emailChangeConfirm.text", { link }),
      html: renderBrandedEmail({
        title: t("email.emailChangeConfirm.title"),
        bodyHtml: t("email.emailChangeConfirm.body"),
        ctaText: t("email.emailChangeConfirm.cta"),
        ctaUrl: link,
        footerNote: t("email.emailChangeConfirm.footer")
      })
    },
    alert: {
      subject: t("email.emailChangeAlert.subject"),
      text: t("email.emailChangeAlert.text"),
      html: renderBrandedEmail({
        title: t("email.emailChangeAlert.title"),
        bodyHtml: t("email.emailChangeAlert.body"),
        ctaText: t("email.emailChangeAlert.cta"),
        ctaUrl: `${env.FRONTEND_URL.replace(/\/+$/, "")}/${locale}/settings`,
        footerNote: t("email.emailChangeAlert.footer")
      })
    }
  };
}

export async function requestEmailChange(
  input: {
    userId: string;
    sessionId: string;
    sessionVersion: number;
    pendingEmail: string;
    stepUpToken: string;
    locale: Locale;
  },
  dependencyOverrides: Partial<EmailChangeDependencies> = {}
) {
  await consumeStepUpToken({
    userId: input.userId,
    sessionId: input.sessionId,
    sessionVersion: input.sessionVersion,
    purpose: "change_email",
    stepUpToken: input.stepUpToken
  });

  const deps = dependencies(dependencyOverrides);
  const pendingEmail = input.pendingEmail.trim().toLowerCase();
  const token = deps.randomToken();
  const tokenHash = hashToken(token);
  const now = deps.now();
  const expiresAt = new Date(now.getTime() + EMAIL_CHANGE_TTL_SECONDS * 1000);

  let requestRow: { id: string; oldEmail: string };
  try {
    requestRow = await inTx(async (client) => {
      const userResult = await client.query<{
        email: string;
        sessionVersion: number;
      }>(
        `select email, session_version as "sessionVersion"
         from users
         where id = $1
         for update`,
        [input.userId]
      );
      const user = userResult.rows[0];
      if (!user || user.sessionVersion !== input.sessionVersion) {
        throw unauthorized("Authentication state changed, log in again");
      }
      if (user.email.toLowerCase() === pendingEmail) {
        throw badRequest("The new email must be different from the current email");
      }

      const existingUser = await client.query(
        `select id from users where lower(email) = $1 and id != $2 limit 1`,
        [pendingEmail, input.userId]
      );
      if (existingUser.rows[0]) throw conflict("Email is already used");

      // The unique pending-email constraint is intentionally unconditional so two live
      // requests can never target the same identity. Reclaim only this exact target
      // when its prior request is no longer usable; otherwise an expired or
      // session-version-stale row could reserve an address forever.
      await client.query(
        `delete from user_email_change_requests email_change
         where email_change.pending_email = $1
           and (
             email_change.expires_at <= $2
             or exists (
               select 1
               from users owner
               where owner.id = email_change.user_id
                 and owner.session_version != email_change.requested_session_version
             )
           )`,
        [pendingEmail, now]
      );

      // The user row lock serializes replacements for one account. A prior request is
      // removed only inside this transaction, so a failed INSERT restores it.
      await client.query(
        `delete from user_email_change_requests where user_id = $1`,
        [input.userId]
      );
      const created = await client.query<{ id: string }>(
        `insert into user_email_change_requests(
           user_id, pending_email, token_hash, requested_session_version,
           expires_at, delivery_confirmed
         )
         values ($1, $2, $3, $4, $5, false)
         returning id`,
        [input.userId, pendingEmail, tokenHash, input.sessionVersion, expiresAt]
      );
      return { id: created.rows[0].id, oldEmail: user.email };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("Email already has a pending change");
    throw error;
  }

  const link = confirmationUrl(input.locale, token);
  const messages = deliveryMessages(input.locale, link);
  let confirmationDelivered: boolean;
  let alertDelivered: boolean;
  try {
    [confirmationDelivered, alertDelivered] = await Promise.all([
      deps.sendEmail({
        to: pendingEmail,
        subject: messages.confirmation.subject,
        html: messages.confirmation.html,
        text: messages.confirmation.text
      }),
      deps.sendEmail({
        to: requestRow.oldEmail,
        subject: messages.alert.subject,
        html: messages.alert.html,
        text: messages.alert.text
      })
    ]);
  } catch {
    await pool.query(
      `delete from user_email_change_requests
       where id = $1 and delivery_confirmed = false`,
      [requestRow.id]
    );
    throw serviceUnavailable("Email change could not be delivered, try again shortly");
  }

  const simulatedDelivery =
    env.NODE_ENV !== "production" &&
    confirmationDelivered === false &&
    alertDelivered === false;
  if ((!confirmationDelivered || !alertDelivered) && !simulatedDelivery) {
    await pool.query(
      `delete from user_email_change_requests
       where id = $1 and delivery_confirmed = false`,
      [requestRow.id]
    );
    throw serviceUnavailable("Email change could not be delivered, try again shortly");
  }

  const marked = await pool.query(
    `update user_email_change_requests
     set delivery_confirmed = true, updated_at = now()
     where id = $1 and token_hash = $2 and delivery_confirmed = false`,
    [requestRow.id, tokenHash]
  );
  if (marked.rowCount !== 1) {
    throw serviceUnavailable("Email change request was superseded, try again");
  }

  return {
    pendingEmail,
    pendingEmailExpiresAt: expiresAt,
    ...(simulatedDelivery ? { debugConfirmationUrl: link } : {})
  };
}

export async function confirmEmailChange(
  input: { token: string },
  dependencyOverrides: Partial<EmailChangeDependencies> = {}
) {
  const deps = dependencies(dependencyOverrides);
  const tokenHash = hashToken(input.token);
  const now = deps.now();

  let activated: { userId: string; email: string };
  try {
    activated = await inTx(async (client) => {
      // Resolve the user id without trusting this unlocked read. The row and all of its
      // conditions are read again under locks below.
      const identity = await client.query<{ userId: string }>(
        `select user_id as "userId"
         from user_email_change_requests
         where token_hash = $1`,
        [tokenHash]
      );
      if (!identity.rows[0]) {
        throw badRequest("Email change token is invalid or expired");
      }

      const userResult = await client.query<{
        sessionVersion: number;
      }>(
        `select session_version as "sessionVersion"
         from users
         where id = $1
         for update`,
        [identity.rows[0].userId]
      );
      const user = userResult.rows[0];
      if (!user) throw badRequest("Email change token is invalid or expired");

      const requestResult = await client.query<{
        userId: string;
        pendingEmail: string;
        requestedSessionVersion: number;
        expiresAt: Date;
        deliveryConfirmed: boolean;
      }>(
        `select user_id as "userId", pending_email as "pendingEmail",
                requested_session_version as "requestedSessionVersion",
                expires_at as "expiresAt", delivery_confirmed as "deliveryConfirmed"
         from user_email_change_requests
         where token_hash = $1 and user_id = $2
         for update`,
        [tokenHash, identity.rows[0].userId]
      );
      const request = requestResult.rows[0];
      if (
        !request ||
        !request.deliveryConfirmed ||
        request.expiresAt.getTime() <= now.getTime() ||
        request.requestedSessionVersion !== user.sessionVersion
      ) {
        throw badRequest("Email change token is invalid or expired");
      }

      const duplicate = await client.query(
        `select id from users where lower(email) = $1 and id != $2 limit 1`,
        [request.pendingEmail, request.userId]
      );
      if (duplicate.rows[0]) throw conflict("Email is already used");

      const updated = await client.query<{ userId: string; email: string }>(
        `update users
         set email = $2,
             email_verified_at = now(),
             email_generation = email_generation + 1,
             session_version = session_version + 1,
             updated_at = now()
         where id = $1
         returning id as "userId", email`,
        [request.userId, request.pendingEmail]
      );
      const consumed = await client.query(
        `delete from user_email_change_requests
         where user_id = $1 and token_hash = $2`,
        [request.userId, tokenHash]
      );
      if (consumed.rowCount !== 1) {
        throw badRequest("Email change token is invalid or expired");
      }
      return updated.rows[0];
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("Email is already used");
    throw error;
  }

  // The database epoch already invalidates every HTTP/refresh credential. Redis and
  // the realtime event close enumerated sessions and live WebSockets after commit.
  await deps.revokeAllUserSessions(activated.userId);
  return activated;
}
