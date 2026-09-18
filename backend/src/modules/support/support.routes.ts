import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncHandler, notFound } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import { requireRole } from "../../common/middleware/rbac.js";
import type { AuthedRequest } from "../../common/types.js";
import {
  buildLookaheadNextCursor,
  keysetWhereClause,
  parseCursorPage
} from "../../common/pagination.js";

const router = Router();

const ticketSchema = z.object({
  email: z.string().email().optional(),
  subject: z.string().min(4).max(160),
  body: z.string().min(20).max(5000),
  priority: z.enum(["low", "normal", "high"]).default("normal")
});

router.post(
  "/tickets",
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = ticketSchema.parse(req.body);
    const userId = req.user?.id ?? null;
    const result = await pool.query(
      `insert into support_tickets(user_id, email, subject, body, priority)
       values ($1, $2, $3, $4, $5)
       returning id, subject, status, priority, created_at as "createdAt"`,
      [userId, input.email ?? req.user?.email ?? null, input.subject, input.body, input.priority]
    );
    res.status(201).json({ ticket: result.rows[0] });
  })
);

router.get(
  "/tickets/me",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { limit, cursor } = parseCursorPage(req.query, { defaultLimit: 100 });
    const values: unknown[] = [req.user.id];
    const cursorWhere = keysetWhereClause(values, cursor, "st.created_at", "st.id");
    values.push(limit + 1);
    const result = await pool.query(
      `select st.id, st.subject, st.body, st.status, st.priority,
              st.created_at as "createdAt", st.created_at::text as "cursorCreatedAt",
              st.updated_at as "updatedAt"
       from support_tickets st
       where st.user_id = $1
         ${cursorWhere ? `and ${cursorWhere}` : ""}
       order by st.created_at desc, st.id desc
       limit $${values.length}`,
      values
    );
    const nextCursor = buildLookaheadNextCursor(
      result.rows.map((row) => ({ id: row.id, createdAt: row.cursorCreatedAt })),
      limit
    );
    const tickets = result.rows
      .slice(0, limit)
      .map(({ cursorCreatedAt: _cursor, ...row }) => row);
    res.json({ tickets, nextCursor });
  })
);

router.get(
  "/admin/tickets",
  authenticate,
  requireRole("admin"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { limit, cursor } = parseCursorPage(req.query, { defaultLimit: 300, maxLimit: 300 });
    const values: unknown[] = [];
    const cursorWhere = keysetWhereClause(values, cursor, "st.created_at", "st.id");
    values.push(limit + 1);
    const result = await pool.query(
      `select st.id, st.email, st.subject, st.body, st.status, st.priority,
              st.created_at as "createdAt", st.created_at::text as "cursorCreatedAt",
              u.display_name as "userDisplayName"
       from support_tickets st
       left join users u on u.id = st.user_id
       ${cursorWhere ? `where ${cursorWhere}` : ""}
       order by st.created_at desc, st.id desc
       limit $${values.length}`,
      values
    );
    const nextCursor = buildLookaheadNextCursor(
      result.rows.map((row) => ({ id: row.id, createdAt: row.cursorCreatedAt })),
      limit
    );
    const tickets = result.rows
      .slice(0, limit)
      .map(({ cursorCreatedAt: _cursor, ...row }) => row);
    res.json({ tickets, nextCursor });
  })
);

router.patch(
  "/admin/tickets/:id",
  authenticate,
  requireRole("admin"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = z.object({ status: z.enum(["open", "in_progress", "resolved", "closed"]) }).parse(req.body);
    const result = await pool.query(
      `update support_tickets
       set status = $2, updated_at = now()
       where id = $1
       returning id, status`,
      [id, body.status]
    );
    if (!result.rows[0]) throw notFound("Ticket not found");
    res.json({ ticket: result.rows[0] });
  })
);

export default router;
