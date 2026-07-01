/**
 * Simulates anonymous marketplace browsing:
 *   - homepage product listing (no filters)
 *   - product listing with category/game filter
 *   - product detail page
 *
 * Run: k6 run -e BASE_URL=https://staging.example.com load-tests/scenarios/browse.js
 *
 * WARNING: Do NOT point this at production without explicit approval.
 * Recommended: staging environment only.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";
import { BASE_URL, defaultThresholds } from "../config.js";

const productDetailDuration = new Trend("product_detail_duration", true);

export const options = {
  scenarios: {
    browse_ramp: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },
        { duration: "2m", target: 200 },
        { duration: "30s", target: 0 }
      ]
    }
  },
  thresholds: {
    ...defaultThresholds,
    product_detail_duration: ["p(95)<1500"]
  }
};

export default function () {
  // 1. Fetch active games list (cached endpoint)
  const gamesRes = http.get(`${BASE_URL}/marketplace/games`);
  check(gamesRes, {
    "games 200": (r) => r.status === 200,
    "games has data": (r) => {
      try {
        return JSON.parse(r.body).games.length > 0;
      } catch {
        return false;
      }
    }
  });

  sleep(0.5);

  // 2. Fetch categories
  const categoriesRes = http.get(`${BASE_URL}/marketplace/categories`);
  check(categoriesRes, { "categories 200": (r) => r.status === 200 });

  sleep(0.3);

  // 3. Fetch product listing — default sort (newest)
  const listRes = http.get(`${BASE_URL}/marketplace/products?sort=newest&limit=20&page=1`);
  check(listRes, {
    "products list 200": (r) => r.status === 200,
    "products list has items": (r) => {
      try {
        return Array.isArray(JSON.parse(r.body).products);
      } catch {
        return false;
      }
    }
  });

  sleep(0.5);

  // 4. Fetch product listing with a game filter
  const filteredRes = http.get(`${BASE_URL}/marketplace/products?game=cs2&sort=price_asc&limit=20&page=1`);
  check(filteredRes, { "filtered products 200": (r) => r.status === 200 });

  sleep(0.3);

  // 5. Open the first product detail (if any returned)
  let products = [];
  try {
    products = JSON.parse(listRes.body).products ?? [];
  } catch {
    // ignore
  }

  if (products.length > 0) {
    const productId = products[Math.floor(Math.random() * Math.min(products.length, 5))].id;
    const start = Date.now();
    const detailRes = http.get(`${BASE_URL}/marketplace/products/${productId}`);
    productDetailDuration.add(Date.now() - start);
    check(detailRes, { "product detail 200": (r) => r.status === 200 });
  }

  sleep(1);
}
