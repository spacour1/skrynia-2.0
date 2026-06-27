import { pool } from "../../db/pool.js";

const SUPPORTED_CURRENCIES = ["UAH", "USD", "EUR"] as const;
type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

type CurrencyRateRow = {
  code: SupportedCurrency;
  rateToUah: string;
  source: string;
  asOf: string;
  updatedAt: string;
};

type ExchangeApiResponse = {
  result?: string;
  time_last_update_unix?: number;
  rates?: Record<string, number>;
};

export async function listCurrencyRates() {
  await ensureSeedRates();
  await refreshRatesIfStale();
  const result = await pool.query<CurrencyRateRow>(
    `select code,
            rate_to_uah as "rateToUah",
            source,
            as_of as "asOf",
            updated_at as "updatedAt"
     from currency_rates
     where code = any($1)
     order by case code when 'UAH' then 0 when 'USD' then 1 when 'EUR' then 2 else 3 end`,
    [SUPPORTED_CURRENCIES]
  );

  return result.rows.map((row) => ({
    code: row.code,
    rateToUah: Number(row.rateToUah),
    source: row.source,
    asOf: row.asOf,
    updatedAt: row.updatedAt
  }));
}

export async function refreshCurrencyRates() {
  await refreshCurrencyRatesFromProvider();
  return listCurrencyRates();
}

async function refreshRatesIfStale() {
  const result = await pool.query<{ shouldRefresh: boolean }>(
    `select exists (
       select 1
       from currency_rates
       where code in ('USD', 'EUR')
         and (source = 'seed' or updated_at < now() - interval '12 hours')
     ) as "shouldRefresh"`
  );

  if (!result.rows[0]?.shouldRefresh) return;
  try {
    await refreshCurrencyRatesFromProvider();
  } catch {
    // Keep the last stored rates when the provider is unavailable.
  }
}

async function refreshCurrencyRatesFromProvider() {
  const response = await fetch("https://open.er-api.com/v6/latest/UAH", {
    headers: { accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`Currency provider responded with ${response.status}`);
  }

  const payload = (await response.json()) as ExchangeApiResponse;
  const usdPerUah = payload.rates?.USD;
  const eurPerUah = payload.rates?.EUR;
  if (payload.result !== "success" || !usdPerUah || !eurPerUah) {
    throw new Error("Currency provider response is missing USD/EUR rates");
  }

  const asOf = payload.time_last_update_unix ? new Date(payload.time_last_update_unix * 1000) : new Date();
  await upsertRate("UAH", 1, "open.er-api.com", asOf);
  await upsertRate("USD", 1 / usdPerUah, "open.er-api.com", asOf);
  await upsertRate("EUR", 1 / eurPerUah, "open.er-api.com", asOf);
}

async function ensureSeedRates() {
  await pool.query(
    `insert into currency_rates(code, rate_to_uah, source, as_of)
     values
       ('UAH', 1, 'seed', now()),
       ('USD', 41.5, 'seed', now()),
       ('EUR', 48, 'seed', now())
     on conflict (code) do nothing`
  );
}

async function upsertRate(code: SupportedCurrency, rateToUah: number, source: string, asOf: Date) {
  await pool.query(
    `insert into currency_rates(code, rate_to_uah, source, as_of, updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (code) do update set
       rate_to_uah = excluded.rate_to_uah,
       source = excluded.source,
       as_of = excluded.as_of,
       updated_at = now()`,
    [code, rateToUah, source, asOf]
  );
}
