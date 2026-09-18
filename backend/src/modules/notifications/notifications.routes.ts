import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncHandler } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import type { AuthedRequest } from "../../common/types.js";
import {
  buildLookaheadNextCursor,
  keysetWhereClause,
  parseCursorPage
} from "../../common/pagination.js";
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
  cursorCreatedAt: string;
};

router.get(
  "/",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { limit, cursor } = parseCursorPage(req.query, { defaultLimit: 30 });
    const values: unknown[] = [req.user.id];
    const cursorWhere = keysetWhereClause(values, cursor, "n.created_at", "n.id");
    values.push(limit + 1);
    const locale = req.locale ?? getRequestLocale(req);
    const [notifications, unread] = await Promise.all([
      pool.query<NotificationRow>(
        `select n.id, n.type, n.title, n.body, n.title_key as "titleKey", n.body_key as "bodyKey", n.params,
                n.order_id as "orderId", n.product_id as "productId",
                n.conversation_id as "conversationId", n.read_at as "readAt",
                n.created_at as "createdAt", n.created_at::text as "cursorCreatedAt"
         from notifications n
         where n.user_id = $1
           ${cursorWhere ? `and ${cursorWhere}` : ""}
         order by n.created_at desc, n.id desc
         limit $${values.length}`,
        values
      ),
      pool.query(`select count(*)::int as count from notifications where user_id = $1 and read_at is null`, [req.user.id])
    ]);
    const nextCursor = buildLookaheadNextCursor(
      notifications.rows.map((row) => ({ id: row.id, createdAt: row.cursorCreatedAt })),
      limit
    );
    // Key-based rows are localized into the requester's language here; the keys are still
    // returned so the client can re-render instantly when the user switches the language.
    const localized = notifications.rows
      .slice(0, limit)
      .map(({ cursorCreatedAt: _cursor, ...row }) => ({
        ...row,
        title: row.titleKey ? t(locale, row.titleKey, row.params ?? undefined) : row.title,
        body: row.bodyKey ? t(locale, row.bodyKey, row.params ?? undefined) : row.body
      }));
    res.json({ notifications: localized, unreadCount: unread.rows[0].count, nextCursor });
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
