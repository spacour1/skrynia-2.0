import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncHandler, badRequest, notFound } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import { cacheGet, cacheSet } from "../../common/redis.js";
import { moneyToCents } from "../../common/validation.js";
import type { AuthedRequest } from "../../common/types.js";
import { isUserOnline } from "../chat/ws.service.js";
import { requestWithdrawal } from "./wallet.service.js";

const router = Router();

const updateMeSchema = z.object({
  displayName: z.string().min(2).max(80).optional(),
  email: z.string().email().optional(),
  avatarUrl: z.string().url().or(z.literal("")).optional().nullable(),
  pushEnabled: z.coerce.boolean().optional(),
  twoFactorEnabled: z.coerce.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).optional()
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8)
});

router.get(
  "/me",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const result = await pool.query(
      `select id, email, display_name as "displayName", role,
              avatar_url as "avatarUrl", push_enabled as "pushEnabled",
              two_factor_enabled as "twoFactorEnabled", settings,
              created_at as "createdAt"
       from users where id = $1`,
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
    if (input.email) {
      const exists = await pool.query(`select id from users where email = $1 and id != $2`, [input.email.toLowerCase(), req.user.id]);
      if (exists.rows[0]) throw badRequest("Email is already used");
    }

    const result = await pool.query(
      `update users
       set display_name = coalesce($2, display_name),
           email = coalesce($3, email),
           avatar_url = coalesce($4, avatar_url),
           push_enabled = coalesce($5, push_enabled),
           two_factor_enabled = coalesce($6, two_factor_enabled),
           settings = coalesce($7, settings),
           updated_at = now()
       where id = $1
       returning id, email, display_name as "displayName", role,
                 avatar_url as "avatarUrl", push_enabled as "pushEnabled",
                 two_factor_enabled as "twoFactorEnabled", settings`,
      [
        req.user.id,
        input.displayName,
        input.email?.toLowerCase(),
        input.avatarUrl === "" ? null : input.avatarUrl,
        input.pushEnabled,
        input.twoFactorEnabled,
        input.settings
      ]
    );
    res.json({ user: result.rows[0] });
  })
);

router.post(
  "/me/password",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = changePasswordSchema.parse(req.body);
    const result = await pool.query(`select password_hash from users where id = $1`, [req.user.id]);
    const hash = result.rows[0]?.password_hash;
    if (!hash) throw badRequest("Password login is not enabled for this account");
    const ok = await bcrypt.compare(input.currentPassword, hash);
    if (!ok) throw badRequest("Current password is incorrect");
    const nextHash = await bcrypt.hash(input.newPassword, 12);
    await pool.query(`update users set password_hash = $2, updated_at = now() where id = $1`, [req.user.id, nextHash]);
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
  currency: z.string().length(3).default("UAH")
});

router.post(
  "/me/wallet/withdraw",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = withdrawSchema.parse(req.body);
    const amountCents = moneyToCents(input.amount);
    if (amountCents < 100) throw badRequest("Minimum withdrawal amount is 1.00");
    const transaction = await requestWithdrawal(req.user.id, amountCents, input.currency.toUpperCase());
    res.status(201).json({ transaction });
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
    const user = await pool.query(
      `select u.id, u.display_name as "displayName", u.avatar_url as "avatarUrl", u.role, u.settings, u.created_at as "createdAt",
              coalesce(avg(r.rating), 0)::float as "ratingAverage",
              count(r.id)::int as "reviewCount"
       from users u
       left join reviews r on r.seller_id = u.id
       where u.id = $1 and u.is_banned = false
       group by u.id`,
      [id]
    );
    if (!user.rows[0]) throw notFound("Seller not found");

    const products = await pool.query(
      `select p.id, p.title, p.description, p.price_cents as "priceCents", p.currency, p.stock,
              p.status, p.delivery_type as "deliveryType", p.product_type as "productType",
              p.old_price_cents as "oldPriceCents", p.sales_count as "salesCount",
              p.is_hot as "isHot", p.is_recommended as "isRecommended",
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

    const stats = await pool.query(
      `select
         count(distinct p.id) filter (where p.status = 'active')::int as "activeListings",
         coalesce(sum(p.sales_count), 0)::int as "totalSales",
         count(distinct pf.user_id)::int as "favoriteCount",
         count(distinct o.id) filter (where o.status in ('paid', 'in_progress', 'delivered'))::int as "activeOrders",
         count(distinct o.id) filter (where o.status = 'completed')::int as "completedOrders",
         count(distinct o.id) filter (where o.status = 'disputed')::int as "disputedOrders",
         coalesce(sum(o.amount_cents) filter (where o.status = 'completed'), 0)::bigint as "completedRevenueCents",
         coalesce(
           round(
             100.0 * count(distinct o.id) filter (where o.status = 'completed')
             / nullif(count(distinct o.id) filter (where o.status in ('completed', 'disputed', 'refunded')), 0),
             0
           ),
           100
         )::int as "successRate"
       from users u
       left join products p on p.seller_id = u.id and p.status != 'deleted'
       left join product_favorites pf on pf.product_id = p.id
       left join orders o on o.seller_id = u.id
       where u.id = $1`,
      [id]
    );

    const seller = user.rows[0];
    res.json({
      user: { ...seller, online: isUserOnline(seller.id) },
      stats: stats.rows[0],
      products: products.rows.map((product) => ({ ...product, sellerOnline: isUserOnline(seller.id) })),
      reviews: reviews.rows
    });
  })
);

export default router;
