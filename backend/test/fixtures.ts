import { randomUUID } from "node:crypto";
import { pool } from "../src/db/pool.js";

export async function resetDb() {
  await pool.query("truncate table users cascade");
  await pool.query("update platform_wallets set revenue_cents = 0");
}

export async function closeDb() {
  await pool.end();
}

export async function createUser(role: "user" | "seller" | "admin" = "user") {
  const id = randomUUID();
  const result = await pool.query<{ id: string }>(
    `insert into users(id, email, display_name, role) values ($1, $2, $3, $4) returning id`,
    [id, `${id}@test.local`, `Test ${id.slice(0, 8)}`, role]
  );
  return result.rows[0].id;
}

export async function createProduct(
  sellerId: string,
  opts: {
    priceCents?: number;
    stock?: number;
    currency?: string;
    deliveryType?: "manual" | "instant";
    deliveryTemplate?: string;
  } = {}
) {
  const category = await pool.query<{ id: string }>(`select id from categories limit 1`);
  const result = await pool.query<{ id: string }>(
    `insert into products(seller_id, category_id, title, description, price_cents, currency, stock, delivery_type, delivery_template)
     values ($1, $2, 'Test product', 'Test description', $3, $4, $5, $6, $7)
     returning id`,
    [
      sellerId,
      category.rows[0].id,
      opts.priceCents ?? 1000,
      opts.currency ?? "UAH",
      opts.stock ?? 5,
      opts.deliveryType ?? "manual",
      opts.deliveryTemplate ?? null
    ]
  );
  return result.rows[0].id;
}

export async function createOrder(
  buyerId: string,
  sellerId: string,
  productId: string,
  opts: { amountCents?: number; currency?: string; status?: string; quantity?: number } = {}
) {
  const result = await pool.query<{ id: string }>(
    `insert into orders(buyer_id, seller_id, product_id, amount_cents, currency, status, quantity)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [
      buyerId,
      sellerId,
      productId,
      opts.amountCents ?? 1000,
      opts.currency ?? "UAH",
      opts.status ?? "pending",
      opts.quantity ?? 1
    ]
  );
  return result.rows[0].id;
}

export async function getWallet(userId: string, currency = "UAH") {
  const result = await pool.query<{ available_cents: string; escrow_cents: string }>(
    `select available_cents, escrow_cents from wallets where user_id = $1 and currency = $2`,
    [userId, currency]
  );
  return result.rows[0] ?? { available_cents: "0", escrow_cents: "0" };
}

export async function getOrder(orderId: string) {
  const result = await pool.query(`select * from orders where id = $1`, [orderId]);
  return result.rows[0];
}

export async function getProduct(productId: string) {
  const result = await pool.query(`select * from products where id = $1`, [productId]);
  return result.rows[0];
}

export async function getPlatformRevenue(currency = "UAH") {
  const result = await pool.query<{ revenue_cents: string }>(
    `select revenue_cents from platform_wallets where currency = $1`,
    [currency]
  );
  return Number(result.rows[0]?.revenue_cents ?? 0);
}

export async function createConversation(buyerId: string, sellerId: string, productId: string | null = null) {
  const result = await pool.query<{ id: string }>(
    `insert into conversations(buyer_id, seller_id, product_id) values ($1, $2, $3) returning id`,
    [buyerId, sellerId, productId]
  );
  return result.rows[0].id;
}

export async function blockUser(blockerId: string, blockedId: string) {
  await pool.query(`insert into user_blocks(blocker_id, blocked_id) values ($1, $2)`, [blockerId, blockedId]);
}

export async function muteUser(userId: string, hours = 1) {
  await pool.query(`update users set muted_until = now() + ($2 || ' hours')::interval where id = $1`, [userId, hours]);
}
