import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncHandler, notFound } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import { requireRole } from "../../common/middleware/rbac.js";
import type { AuthedRequest } from "../../common/types.js";

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
    const result = await pool.query(
      `select id, subject, body, status, priority, created_at as "createdAt", updated_at as "updatedAt"
       from support_tickets
       where user_id = $1
       order by created_at desc
       limit 100`,
      [req.user.id]
    );
    res.json({ tickets: result.rows });
  })
);

router.get(
  "/admin/tickets",
  authenticate,
  requireRole("admin"),
  asyncHandler(async (_req: AuthedRequest, res) => {
    const result = await pool.query(
      `select st.id, st.email, st.subject, st.body, st.status, st.priority,
              st.created_at as "createdAt", u.display_name as "userDisplayName"
       from support_tickets st
       left join users u on u.id = st.user_id
       order by st.created_at desc
       limit 300`
    );
    res.json({ tickets: result.rows });
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
