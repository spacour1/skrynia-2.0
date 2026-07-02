import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncHandler } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import type { AuthedRequest } from "../../common/types.js";
import { getRequestLocale, t, type TranslateParams } from "../../i18n/t.js";

const router = Router();

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  titleKey: string | null;
  bodyKey: string | null;
  params: TranslateParams | null;
  orderId: string | null;
  productId: string | null;
  conversationId: string | null;
  readAt: string | null;
  createdAt: string;
};

router.get(
  "/",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const limit = z.coerce.number().int().min(1).max(100).default(30).parse(req.query.limit);
    const locale = req.locale ?? getRequestLocale(req);
    const [notifications, unread] = await Promise.all([
      pool.query<NotificationRow>(
        `select id, type, title, body, title_key as "titleKey", body_key as "bodyKey", params,
                order_id as "orderId", product_id as "productId",
                conversation_id as "conversationId", read_at as "readAt", created_at as "createdAt"
         from notifications
         where user_id = $1
         order by created_at desc
         limit $2`,
        [req.user.id, limit]
      ),
      pool.query(`select count(*)::int as count from notifications where user_id = $1 and read_at is null`, [req.user.id])
    ]);
    // Key-based rows are localized into the requester's language here; the keys are still
    // returned so the client can re-render instantly when the user switches the language.
    const localized = notifications.rows.map((row) => ({
      ...row,
      title: row.titleKey ? t(locale, row.titleKey, row.params ?? undefined) : row.title,
      body: row.bodyKey ? t(locale, row.bodyKey, row.params ?? undefined) : row.body
    }));
    res.json({ notifications: localized, unreadCount: unread.rows[0].count });
  })
);

router.post(
  "/:id/read",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const result = await pool.query(
      `update notifications
       set read_at = coalesce(read_at, now())
       where id = $1 and user_id = $2
       returning id, read_at as "readAt"`,
      [id, req.user.id]
    );
    res.json({ notification: result.rows[0] ?? null });
  })
);

router.post(
  "/read-all",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    await pool.query(`update notifications set read_at = coalesce(read_at, now()) where user_id = $1`, [req.user.id]);
    res.json({ ok: true });
  })
);

export default router;
