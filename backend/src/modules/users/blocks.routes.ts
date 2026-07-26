import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncHandler, badRequest, notFound } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import { requireEmailVerified } from "../../common/middleware/require-email-verified.js";
import type { AuthedRequest } from "../../common/types.js";
import {
  buildLookaheadNextCursor,
  keysetWhereClause,
  parseCursorPage
} from "../../common/pagination.js";

const router = Router();

router.post(
  "/:id/block",
  authenticate,
  requireEmailVerified,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    if (id === req.user.id) throw badRequest("You cannot block yourself");
    const target = await pool.query(`select id from users where id = $1`, [id]);
    if (!target.rows[0]) throw notFound("User not found");
    await pool.query(`insert into user_blocks(blocker_id, blocked_id) values ($1, $2) on conflict do nothing`, [
      req.user.id,
      id
    ]);
    res.status(204).send();
  })
);

router.delete(
  "/:id/block",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    await pool.query(`delete from user_blocks where blocker_id = $1 and blocked_id = $2`, [req.user.id, id]);
    res.status(204).send();
  })
);

router.get(
  "/me/blocked",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { limit, cursor } = parseCursorPage(req.query);
    const values: unknown[] = [req.user.id];
    const cursorWhere = keysetWhereClause(values, cursor, "ub.created_at", "ub.blocked_id");
    values.push(limit + 1);
    const result = await pool.query(
      `select u.id, u.display_name as "displayName", u.avatar_url as "avatarUrl",
              ub.created_at as "createdAt", ub.created_at::text as "cursorCreatedAt"
       from user_blocks ub
       join users u on u.id = ub.blocked_id
       where ub.blocker_id = $1
         ${cursorWhere ? `and ${cursorWhere}` : ""}
       order by ub.created_at desc, ub.blocked_id desc
       limit $${values.length}`,
      values
    );
    const nextCursor = buildLookaheadNextCursor(
      result.rows.map((row) => ({ id: row.id, createdAt: row.cursorCreatedAt })),
      limit
    );
    const blocked = result.rows
      .slice(0, limit)
      .map(({ cursorCreatedAt: _cursor, ...row }) => row);
    res.json({ blocked, nextCursor });
  })
);

export default router;
