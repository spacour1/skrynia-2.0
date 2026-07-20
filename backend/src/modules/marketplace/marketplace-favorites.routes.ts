import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncHandler, notFound } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import type { AuthedRequest } from "../../common/types.js";
import { addSellerPresence, attachCardMetadata } from "./marketplace.helpers.js";
import { productSelect } from "./marketplace.sql.js";

const router = Router();

router.get(
  "/favorites/ids",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const result = await pool.query(
      `select product_id as "productId" from product_favorites where user_id = $1 order by created_at desc`,
      [req.user.id]
    );
    res.json({ productIds: result.rows.map((row) => row.productId) });
  })
);

router.get(
  "/favorites",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const result = await pool.query(
      `${productSelect}
       join product_favorites own_favorite on own_favorite.product_id = p.id and own_favorite.user_id = $1
       where p.status = 'active' and p.stock > 0 and u.is_banned = false
       group by p.id, c.id, g.id, gs.id, u.id
       order by max(own_favorite.created_at) desc`,
      [req.user.id]
    );
    res.json({
      products: await attachCardMetadata(await addSellerPresence(result.rows))
    });
  })
);

router.put(
  "/favorites/:productId",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const productId = z.string().uuid().parse(req.params.productId);
    const product = await pool.query(`select id from products where id = $1 and status = 'active'`, [productId]);
    if (!product.rows[0]) throw notFound("Product not found");
    await pool.query(
      `insert into product_favorites(user_id, product_id) values ($1, $2) on conflict do nothing`,
      [req.user.id, productId]
    );
    res.json({ ok: true, liked: true });
  })
);

router.delete(
  "/favorites/:productId",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const productId = z.string().uuid().parse(req.params.productId);
    await pool.query(`delete from product_favorites where user_id = $1 and product_id = $2`, [req.user.id, productId]);
    res.json({ ok: true, liked: false });
  })
);

export default router;
