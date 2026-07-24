import bcrypt from "bcryptjs";
import { pool } from "./pool.js";

if (
  process.env.NODE_ENV !== "test" ||
  process.env.E2E_SEED_ENABLED !== "true"
) {
  throw new Error(
    "E2E seed is disabled unless NODE_ENV=test and E2E_SEED_ENABLED=true"
  );
}

const email = process.env.E2E_ADMIN_EMAIL;
const password = process.env.E2E_ADMIN_PASSWORD;
if (!email || !password || password.length < 8) {
  throw new Error("E2E_ADMIN_EMAIL and a valid E2E_ADMIN_PASSWORD are required");
}

const passwordHash = await bcrypt.hash(password, 12);
const admin = await pool.query<{ id: string }>(
  `insert into users(
     email, password_hash, display_name, role, email_verified_at
   )
   values ($1, $2, $3, 'admin', now())
   on conflict (email) do update set
     password_hash = excluded.password_hash,
     display_name = excluded.display_name,
     role = 'admin',
     email_verified_at = now(),
     is_banned = false,
     updated_at = now()
   returning id`,
  [email.toLowerCase(), passwordHash, "E2E Administrator"]
);
await pool.query(
  `insert into wallets(user_id, currency)
   values ($1, 'UAH')
   on conflict (user_id, currency) do nothing`,
  [admin.rows[0].id]
);

await pool.end();
console.log("Isolated E2E admin seeded");
