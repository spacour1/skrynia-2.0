import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncHandler, notFound } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import type { AuthedRequest } from "../../common/types.js";
import {
  buildLookaheadNextCursor,
  keysetWhereClause,
  parseCursorPage
} from "../../common/pagination.js";
import {
  addSellerPresence,
  attachCardMetadata,
  mapProductMoneyFields
} from "./marketplace.helpers.js";
import { productSelect } from "./marketplace.sql.js";

const router = Router();

router.get(
  "/favorites/ids",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { limit, cursor } = parseCursorPage(req.query);
    const values: unknown[] = [req.user.id];
    const cursorWhere = keysetWhereClause(values, cursor, "pf.created_at", "pf.product_id");
    values.push(limit + 1);
    const result = await pool.query<{ id: string; productId: string; createdAt: Date | string }>(
      `select pf.product_id as id, pf.product_id as "productId", pf.created_at::text as "createdAt"
       from product_favorites pf
       where pf.user_id = $1
         ${cursorWhere ? `and ${cursorWhere}` : ""}
       order by pf.created_at desc, pf.product_id desc
       limit $${values.length}`,
      values
    );
    res.json({
      productIds: result.rows.slice(0, limit).map((row) => row.productId),
      nextCursor: buildLookaheadNextCursor(result.rows, limit)
    });
  })
);

router.get(
  "/favorites",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { limit, cursor } = parseCursorPage(req.query);
    const favoriteValues: unknown[] = [req.user.id];
    const cursorWhere = keysetWhereClause(
      favoriteValues,
      cursor,
      "pf.created_at",
      "pf.product_id"
    );
    favoriteValues.push(limit + 1);
    const favorites = await pool.query<{ id: string; productId: string; createdAt: Date | string }>(
      `select pf.product_id as id, pf.product_id as "productId", pf.created_at::text as "createdAt"
       from product_favorites pf
       join products p on p.id = pf.product_id
       join users u on u.id = p.seller_id
       where pf.user_id = $1
         and p.status = 'active'
         and p.stock > 0
         and u.is_banned = false
         ${cursorWhere ? `and ${cursorWhere}` : ""}
       order by pf.created_at desc, pf.product_id desc
       limit $${favoriteValues.length}`,
      favoriteValues
    );
    const pageFavorites = favorites.rows.slice(0, limit);
    const productIds = pageFavorites.map((favorite) => favorite.productId);
    const result = productIds.length
      ? await pool.query(
      `${productSelect}
       where p.id = any($1::uuid[]) and p.status = 'active' and p.stock > 0 and u.is_banned = false
       group by p.id, c.id, g.id, gs.id, u.id
       order by p.created_at desc, p.id desc`,
          [productIds]
        )
      : { rows: [] };
    const productsById = new Map(
      result.rows.map((row) => [row.id as string, mapProductMoneyFields(row)])
    );
    const orderedProducts = productIds
      .map((productId) => productsById.get(productId))
      .filter((product): product is NonNullable<typeof product> => Boolean(product));
    res.json({
      products: await attachCardMetadata(
        await addSellerPresence(orderedProducts)
      ),
      nextCursor: buildLookaheadNextCursor(favorites.rows, limit)
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
