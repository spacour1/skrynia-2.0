import { Router, type Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { inTx, pool } from "../../db/pool.js";
import { asyncHandler, badRequest, notFound } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import { requireEmailVerified } from "../../common/middleware/require-email-verified.js";
import { requirePhoneVerified } from "../../common/middleware/require-phone-verified.js";
import {
  credentialRateLimit,
  phoneOtpRateLimit
} from "../../common/middleware/security.js";
import { cacheGet, cacheSet } from "../../common/redis.js";
import { moneyToCents } from "../../common/validation.js";
import type { AuthedRequest } from "../../common/types.js";
import { isUserOnline } from "../chat/ws.service.js";
import { requestWithdrawal } from "./wallet.service.js";
import { createAndSendVerificationEmail, fireAndForget } from "../auth/verification.service.js";
import { issueSession, revokeAllUserSessions } from "../auth/session.service.js";
import { setAuthCookies } from "../../common/cookies.js";
import { checkPhoneResendRateLimit } from "./phone-verification.service.js";
import { sendPhoneVerificationCode, checkPhoneVerificationCode } from "../../common/sms.js";
import { createTelegramConnectToken, disconnectTelegram } from "./telegram-link.service.js";
import { getNotificationPreferences, updateNotificationPreferences } from "../notifications/preferences.service.js";
import { createNotification } from "../notifications/notifications.service.js";
import {
  confirmTwoFactor,
  disableTwoFactor,
  regenerateTwoFactorBackupCodes,
  setupTwoFactor
} from "../auth/twofa.service.js";
import {
  attachStorageObject,
  buildMediaUrl,
  enqueueStorageDeletion
} from "../storage/storage.service.js";
import { locales } from "../../i18n/config.js";
import { getRequestLocale } from "../../i18n/t.js";
import { attachCardMetadata } from "../marketplace/marketplace.helpers.js";
import { normalizedRequestEndpoint, requestPath } from "../../common/request-url.js";
import {
  toPublicSellerDto,
  toPublicSellerStatsDto,
  type PublicSellerOverviewRow
} from "./public-seller.dto.js";

const router = Router();

const updateMeSchema = z.object({
  displayName: z.string().min(2).max(80).optional(),
  email: z.string().email().optional(),
  avatarUploadId: z.string().uuid().optional(),
  clearAvatar: z.boolean().optional(),
  sellerBannerUploadId: z.string().uuid().optional(),
  clearSellerBanner: z.boolean().optional(),
  avatarUrl: z.undefined().optional(),
  pushEnabled: z.coerce.boolean().optional(),
  // twoFactorEnabled is intentionally NOT settable here - it used to be a bare client-writable
  // flag with no actual login-time check behind it ("fake 2FA"). It can only flip on/off
  // through /me/2fa/enable and /me/2fa/disable, which require a real confirmed TOTP code.
  settings: z.record(z.string(), z.unknown()).optional()
}).superRefine((value, ctx) => {
  if (value.avatarUploadId && value.clearAvatar) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["avatarUploadId"],
      message: "Cannot upload and clear the avatar in one request"
    });
  }
  if (value.sellerBannerUploadId && value.clearSellerBanner) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sellerBannerUploadId"],
      message: "Cannot upload and clear the seller banner in one request"
    });
  }
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(8)
    .refine((value) => /[A-Z]/.test(value), "Password must contain an uppercase letter")
    .refine((value) => /[0-9]/.test(value), "Password must contain a number")
    .refine((value) => /[^A-Za-z0-9]/.test(value), "Password must contain a special character")
});

async function rotateSecuritySession(req: AuthedRequest, res: Response) {
  await revokeAllUserSessions(req.user.id);
  const session = await issueSession(req.user.id, req.user.role);
  setAuthCookies(res, session);
}

router.get(
  "/me",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const result = await pool.query(
      `select u.id, u.email, u.display_name as "displayName", u.role,
              u.avatar_url as "avatarUrl", u.push_enabled as "pushEnabled",
              u.two_factor_enabled as "twoFactorEnabled", u.settings,
              u.preferred_locale as "preferredLocale",
              u.created_at as "createdAt",
              (u.email_verified_at is not null or u.telegram_id is not null) as "emailVerified",
              u.phone, (u.phone_verified_at is not null) as "phoneVerified",
              (ta.connected_at is not null) as "telegramConnected"
       from users u
       left join telegram_accounts ta on ta.user_id = u.id
       where u.id = $1`,
      [req.user.id]
    );
    res.json({ user: result.rows[0] });
  })
);

router.patch(
  "/me",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = updateMeSchema.parse(req.body);
    const emailChanged = Boolean(input.email && input.email.toLowerCase() !== req.user.email.toLowerCase());
    if (emailChanged) {
      const exists = await pool.query(`select id from users where email = $1 and id != $2`, [input.email!.toLowerCase(), req.user.id]);
      if (exists.rows[0]) throw badRequest("Email is already used");
    }

    const user = await inTx(async (client) => {
      const currentResult = await client.query<{
        avatarStorageObjectId: string | null;
        sellerBannerStorageObjectId: string | null;
        settings: Record<string, unknown>;
      }>(
        `select avatar_storage_object_id as "avatarStorageObjectId",
                seller_banner_storage_object_id as "sellerBannerStorageObjectId",
                settings
         from users
         where id = $1
         for update`,
        [req.user.id]
      );
      const current = currentResult.rows[0];
      if (!current) throw notFound("User not found");

      const avatar = input.avatarUploadId
        ? await attachStorageObject(client, {
            uploadId: input.avatarUploadId,
            ownerId: req.user.id,
            purpose: "avatar"
          })
        : null;
      const banner = input.sellerBannerUploadId
        ? await attachStorageObject(client, {
            uploadId: input.sellerBannerUploadId,
            ownerId: req.user.id,
            purpose: "avatar"
          })
        : null;

      const settings = input.settings
        ? { ...input.settings }
        : { ...current.settings };
      const currentBannerUrl = current.settings.sellerBannerUrl;
      if (banner) {
        settings.sellerBannerUrl = buildMediaUrl(banner.objectKey);
      } else if (input.clearSellerBanner) {
        delete settings.sellerBannerUrl;
      } else if (currentBannerUrl !== undefined) {
        settings.sellerBannerUrl = currentBannerUrl;
      } else {
        delete settings.sellerBannerUrl;
      }

      const updated = await client.query(
        `update users
         set display_name = coalesce($2, display_name),
             email = coalesce($3, email),
             avatar_url = case
               when $4 then null
               when $5::text is not null then $5
               else avatar_url
             end,
             avatar_storage_object_id = case
               when $4 then null
               when $6::uuid is not null then $6
               else avatar_storage_object_id
             end,
             seller_banner_storage_object_id = case
               when $7 then null
               when $8::uuid is not null then $8
               else seller_banner_storage_object_id
             end,
             push_enabled = coalesce($9, push_enabled),
             settings = $10,
             email_verified_at = case when $11 then null else email_verified_at end,
             updated_at = now()
         where id = $1
         returning id, email, display_name as "displayName", role,
                   avatar_url as "avatarUrl", push_enabled as "pushEnabled",
                   two_factor_enabled as "twoFactorEnabled", settings,
                   (email_verified_at is not null or telegram_id is not null) as "emailVerified",
                   phone, (phone_verified_at is not null) as "phoneVerified"`,
        [
          req.user.id,
          input.displayName,
          input.email?.toLowerCase(),
          Boolean(input.clearAvatar),
          avatar ? buildMediaUrl(avatar.objectKey) : null,
          avatar?.id ?? null,
          Boolean(input.clearSellerBanner),
          banner?.id ?? null,
          input.pushEnabled,
          settings,
          emailChanged
        ]
      );

      if (
        current.avatarStorageObjectId &&
        (avatar || input.clearAvatar)
      ) {
        await enqueueStorageDeletion(client, current.avatarStorageObjectId);
      }
      if (
        current.sellerBannerStorageObjectId &&
        (banner || input.clearSellerBanner)
      ) {
        await enqueueStorageDeletion(
          client,
          current.sellerBannerStorageObjectId
        );
      }
      return updated.rows[0];
    });
    if (emailChanged) {
      fireAndForget(
        createAndSendVerificationEmail(user, getRequestLocale(req)).then((created) => created.sendPromise),
        "profile_email_change_verification_failed"
      );
      // Alerts the address being replaced, not the new one — the account may not be the
      // one who changed it, so the old inbox is the one that needs to know.
      await createNotification({
        userId: user.id,
        type: "email_changed",
        templateKey: "notifications.emailChanged",
        params: { newEmail: user.email },
        emailOverride: req.user.email
      });
    }
    res.json({ user });
  })
);

const localeSchema = z.object({ locale: z.enum(locales) });

// Called by the frontend language switcher: persists the explicit language choice so
// emails/Telegram notifications and the next login use it. Guests keep only the cookie.
router.patch(
  "/me/locale",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = localeSchema.parse(req.body);
    await pool.query(`update users set preferred_locale = $2, updated_at = now() where id = $1`, [req.user.id, input.locale]);
    res.json({ preferredLocale: input.locale });
  })
);

router.post(
  "/me/password",
  authenticate,
  credentialRateLimit,
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = changePasswordSchema.parse(req.body);
    const result = await pool.query(`select password_hash from users where id = $1`, [req.user.id]);
    const hash = result.rows[0]?.password_hash;
    if (!hash) throw badRequest("Password login is not enabled for this account");
    const ok = await bcrypt.compare(input.currentPassword, hash);
    if (!ok) throw badRequest("Current password is incorrect");
    const nextHash = await bcrypt.hash(input.newPassword, 12);
    // One UPDATE = one implicit transaction: the new password and the session-version
    // bump land together, so old sessions die with the change even if the Redis
    // revocation in rotateSecuritySession fails.
    await pool.query(
      `update users set password_hash = $2, session_version = session_version + 1, updated_at = now() where id = $1`,
      [req.user.id, nextHash]
    );
    // Kill every session on a password change - including this one's refresh token, which
    // exceptJti used to leave dangling-revoked (the tab then silently logged out ~15 min
    // later when its access token expired). Instead the caller immediately gets a brand
    // new access+refresh+csrf session in this response: other devices are out, this tab
    // stays seamlessly signed in.
    await rotateSecuritySession(req, res);
    await createNotification({
      userId: req.user.id,
      type: "password_changed",
      templateKey: "notifications.passwordChanged"
    });
    res.json({ ok: true });
  })
);

router.get(
  "/me/wallet",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const cached = await cacheGet(`user:${req.user.id}:wallet`);
    if (cached) return res.json(cached);
    await pool.query(`insert into wallets(user_id, currency) values ($1, 'UAH') on conflict (user_id, currency) do nothing`, [req.user.id]);
    const wallets = await pool.query(
      `select id, currency, available_cents as "availableCents", escrow_cents as "escrowCents"
       from wallets
       where user_id = $1
       order by case currency when 'UAH' then 0 when 'USD' then 1 when 'EUR' then 2 else 3 end, currency`,
      [req.user.id]
    );
    const transactions = await pool.query(
      `select id, order_id as "orderId", type, direction, amount_cents as "amountCents", currency, status, metadata, created_at as "createdAt"
       from transactions
       where user_id = $1
       order by created_at desc
       limit 100`,
       [req.user.id]
    );
    const primaryWallet = wallets.rows.find((item) => item.currency === "UAH") ?? wallets.rows[0] ?? null;
    const payload = { wallet: primaryWallet, wallets: wallets.rows, transactions: transactions.rows };
    await cacheSet(`user:${req.user.id}:wallet`, payload, 15);
    res.json(payload);
  })
);

const withdrawSchema = z.object({
  amount: z.string(),
  currency: z.string().length(3).default("UAH"),
  destination: z.object({
    method: z.enum(["card", "iban"]),
    accountNumber: z.string().min(4).max(64),
    holderName: z.string().min(2).max(120),
    bankName: z.string().max(120).optional()
  })
});

router.post(
  "/me/wallet/withdraw",
  authenticate,
  requireEmailVerified,
  requirePhoneVerified,
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = withdrawSchema.parse(req.body);
    const amountCents = moneyToCents(input.amount);
    if (amountCents < 100) throw badRequest("Minimum withdrawal amount is 1.00");
    const payout = await requestWithdrawal(req.user.id, amountCents, input.currency.toUpperCase(), input.destination);
    res.status(201).json({ payout });
  })
);

const phoneRequestSchema = z.object({
  phone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, "Phone must be in international format, e.g. +380501234567")
});
const phoneConfirmSchema = z.object({ code: z.string().min(4).max(8) });

router.post(
  "/me/phone/request",
  authenticate,
  phoneOtpRateLimit,
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = phoneRequestSchema.parse(req.body);
    await checkPhoneResendRateLimit(req.user.id);

    const existing = await pool.query(`select id from users where phone = $1 and id != $2`, [input.phone, req.user.id]);
    if (existing.rows[0]) throw badRequest("This phone number is already linked to another account");

    const sent = await sendPhoneVerificationCode(input.phone);
    if (!sent) throw badRequest("Could not send the verification code right now, try again later");

    await pool.query(`update users set phone = $1, phone_verified_at = null where id = $2`, [input.phone, req.user.id]);
    res.json({ status: "sent" });
  })
);

router.post(
  "/me/phone/confirm",
  authenticate,
  phoneOtpRateLimit,
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = phoneConfirmSchema.parse(req.body);
    const result = await pool.query(`select phone from users where id = $1`, [req.user.id]);
    const phone = result.rows[0]?.phone;
    if (!phone) throw badRequest("Request a code first");

    const approved = await checkPhoneVerificationCode(phone, input.code);
    if (!approved) throw badRequest("Invalid or expired code");

    await pool.query(`update users set phone_verified_at = now() where id = $1`, [req.user.id]);
    res.json({ status: "verified" });
  })
);

const twoFactorReauthenticationSchema = z.object({
  currentPassword: z.string().min(1).max(256).optional(),
  totpCode: z.string().min(4).max(16).optional()
});

function twoFactorAuditContext(req: AuthedRequest) {
  return {
    traceId: req.traceId,
    method: req.method,
    path: requestPath(req),
    endpoint: normalizedRequestEndpoint(req)
  };
}

router.post(
  "/me/2fa/setup",
  authenticate,
  credentialRateLimit,
  asyncHandler(async (req: AuthedRequest, res) => {
    const reauthentication = twoFactorReauthenticationSchema.parse(req.body ?? {});
    const { secret, otpauthUri } = await setupTwoFactor(
      req.user.id,
      req.user.email,
      reauthentication
    );
    res.json({ secret, otpauthUri });
  })
);

const twoFactorEnableSchema = z.object({ code: z.string().min(4).max(16) });

router.post(
  "/me/2fa/enable",
  authenticate,
  credentialRateLimit,
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = twoFactorEnableSchema.parse(req.body);
    const backupCodes = await confirmTwoFactor(
      req.user.id,
      input.code,
      twoFactorAuditContext(req)
    );
    await rotateSecuritySession(req, res);
    res.json({ backupCodes });
  })
);

router.post(
  "/me/2fa/disable",
  authenticate,
  credentialRateLimit,
  asyncHandler(async (req: AuthedRequest, res) => {
    const reauthentication = twoFactorReauthenticationSchema.parse(req.body ?? {});
    await disableTwoFactor(
      req.user.id,
      reauthentication,
      twoFactorAuditContext(req)
    );
    await rotateSecuritySession(req, res);
    res.json({ ok: true });
  })
);

router.post(
  "/me/2fa/backup-codes/regenerate",
  authenticate,
  credentialRateLimit,
  asyncHandler(async (req: AuthedRequest, res) => {
    const reauthentication = twoFactorReauthenticationSchema.parse(req.body ?? {});
    const backupCodes = await regenerateTwoFactorBackupCodes(
      req.user.id,
      reauthentication,
      twoFactorAuditContext(req)
    );
    await rotateSecuritySession(req, res);
    res.json({ backupCodes });
  })
);

router.post(
  "/me/telegram/connect",
  authenticate,
  credentialRateLimit,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { token, link } = await createTelegramConnectToken(req.user.id);
    res.json({ token, link });
  })
);

router.post(
  "/me/telegram/disconnect",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    await disconnectTelegram(req.user.id);
    res.json({ ok: true });
  })
);

const notificationPreferencesSchema = z.object({
  emailEnabled: z.boolean().optional(),
  telegramEnabled: z.boolean().optional()
});

router.get(
  "/me/notifications/preferences",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const preferences = await getNotificationPreferences(req.user.id);
    res.json({ preferences });
  })
);

router.patch(
  "/me/notifications/preferences",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = notificationPreferencesSchema.parse(req.body);
    const preferences = await updateNotificationPreferences(req.user.id, input);
    res.json({ preferences });
  })
);

router.get(
  "/me/seller-favorites",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const result = await pool.query(
      `select u.id, u.display_name as "displayName", u.avatar_url as "avatarUrl",
              coalesce(avg(r.rating), 0)::float as "ratingAverage",
              count(distinct r.id)::int as "reviewCount",
              count(distinct p.id) filter (where p.status = 'active')::int as "activeListings",
              sf.created_at as "createdAt"
       from seller_favorites sf
       join users u on u.id = sf.seller_id
       left join reviews r on r.seller_id = u.id
       left join products p on p.seller_id = u.id
       where sf.user_id = $1 and u.is_banned = false
       group by u.id, sf.created_at
       order by sf.created_at desc`,
      [req.user.id]
    );
    res.json({ sellers: result.rows, sellerIds: result.rows.map((row) => row.id) });
  })
);

router.put(
  "/:id/favorite",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    if (id === req.user.id) throw badRequest("You cannot favorite yourself");
    const seller = await pool.query(`select id from users where id = $1 and is_banned = false`, [id]);
    if (!seller.rows[0]) throw notFound("Seller not found");
    await pool.query(`insert into seller_favorites(user_id, seller_id) values ($1, $2) on conflict do nothing`, [req.user.id, id]);
    res.status(204).send();
  })
);

router.delete(
  "/:id/favorite",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    await pool.query(`delete from seller_favorites where user_id = $1 and seller_id = $2`, [req.user.id, id]);
    res.status(204).send();
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const overview = await pool.query<PublicSellerOverviewRow>(
      `with product_stats as (
         select
           count(*) filter (where status = 'active')::int as active_listings,
           coalesce(sum(sales_count) filter (where status != 'deleted'), 0)::int as total_sales
         from products
         where seller_id = $1
       ),
       favorite_stats as (
         select count(*)::int as favorite_count
         from product_favorites pf
         join products p on p.id = pf.product_id
         where p.seller_id = $1 and p.status != 'deleted'
       ),
       order_stats as (
         select
           count(*) filter (where status in ('paid', 'in_progress', 'delivered'))::int as active_orders,
           count(*) filter (where status = 'completed')::int as completed_orders,
           count(*) filter (where status = 'disputed')::int as disputed_orders,
           count(*) filter (where status = 'refunded')::int as refunded_orders,
           count(*) filter (where status in ('completed', 'disputed', 'refunded'))::int as terminal_orders,
           coalesce(sum(amount_cents) filter (where status = 'completed'), 0)::bigint as completed_revenue_cents
         from orders
         where seller_id = $1
       ),
       review_stats as (
         select coalesce(avg(rating), 0)::float as rating_average, count(*)::int as review_count
         from reviews
         where seller_id = $1
       )
       select
         u.id,
         u.display_name as "displayName",
         u.avatar_url as "avatarUrl",
         u.created_at as "createdAt",
         rs.rating_average as "ratingAverage",
         rs.review_count as "reviewCount",
         ps.active_listings as "activeListings",
         ps.total_sales as "totalSales",
         fs.favorite_count as "favoriteCount",
         os.active_orders as "activeOrders",
         os.completed_orders as "completedOrders",
         os.disputed_orders as "disputedOrders",
         os.refunded_orders as "refundedOrders",
         os.completed_revenue_cents as "completedRevenueCents",
         case
           when os.terminal_orders >= 3
             then round(100.0 * os.completed_orders / nullif(os.terminal_orders, 0), 0)::int
           else null
         end as "successRate",
         (os.terminal_orders >= 3) as "hasEnoughData"
       from users u
       cross join product_stats ps
       cross join favorite_stats fs
       cross join order_stats os
       cross join review_stats rs
       where u.id = $1 and u.is_banned = false`,
      [id]
    );
    if (!overview.rows[0]) throw notFound("User not found");

    const products = await pool.query(
      `select p.id, p.title, p.description, p.price_cents as "priceCents", p.currency, p.stock,
              p.status, p.delivery_type as "deliveryType", p.product_type as "productType",
              p.old_price_cents as "oldPriceCents", p.sales_count as "salesCount",
              p.is_hot as "isHot", p.is_recommended as "isRecommended",
              p.server, p.platform, p.metadata,
              p.section_id as "sectionId", p.schema_version as "schemaVersion",
              p.created_at as "createdAt",
              c.slug as "categorySlug", c.name as "categoryName",
              g.slug as "gameSlug", g.name as "gameName",
              gs.slug as "sectionSlug", gs.name as "sectionName",
              count(distinct pf.user_id)::int as "favoriteCount"
       from products p
       join categories c on c.id = p.category_id
       left join games g on g.id = p.game_id
       left join game_sections gs on gs.id = p.section_id
       left join product_favorites pf on pf.product_id = p.id
       where p.seller_id = $1 and p.status = 'active'
       group by p.id, c.id, g.id, gs.id
       order by p.created_at desc limit 24`,
      [id]
    );

    const reviews = await pool.query(
      `select r.id, r.rating, r.comment, r.created_at as "createdAt",
              b.display_name as "buyerDisplayName",
              p.title as "productTitle"
       from reviews r
       join users b on b.id = r.buyer_id
       join orders o on o.id = r.order_id
       join products p on p.id = o.product_id
       where r.seller_id = $1
       order by r.created_at desc limit 20`,
      [id]
    );

    const sellerPresence = await isUserOnline(overview.rows[0].id);
    const seller = toPublicSellerDto(overview.rows[0], sellerPresence);
    const stats = toPublicSellerStatsDto(overview.rows[0]);
    const productsWithCardMetadata = await attachCardMetadata(products.rows);
    res.json({
      user: seller,
      stats,
      products: productsWithCardMetadata.map((product) => ({
        ...product,
        sellerOnline: sellerPresence
      })),
      reviews: reviews.rows
    });
  })
);

export default router;
