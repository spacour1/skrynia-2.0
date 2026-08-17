import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  FinancialFreezeSafeFailure,
  checkFinancialFreeze,
  normalizeRepoPath,
  parseNameStatusZ,
  parseZeroContextHunks,
  validateConfig
} from "./check-financial-freeze.mjs";

const TEST_CONFIG_PATH = "config/financial-freeze.json";

const testConfig = {
  schemaVersion: 1,
  pathRules: [
    {
      id: "core-financial-files",
      type: "files",
      paths: ["backend/src/domain/money.ts", "backend/src/modules/users/wallet.service.ts"]
    },
    {
      id: "financial-domains",
      type: "prefix",
      prefixes: ["backend/src/modules/payments/", "backend/src/modules/orders/"],
      extensions: [".ts"]
    },
    {
      id: "financial-tests",
      type: "files",
      paths: ["backend/test/ledger.test.ts"]
    },
    {
      id: "financial-code-path-names",
      type: "path-regex",
      patterns: [
        "(?:^|/)(?:payments?|wallet|ledger|escrow|payouts?|refunds?|settlements?|reconciliation|currencies|currency|money|accounting|finance|fees?|transactions?|orders?)(?:[./_-]|$)"
      ],
      extensions: [".ts", ".tsx"]
    },
    {
      id: "financial-camelcase-path-names",
      type: "path-regex",
      caseSensitive: true,
      patterns: [
        "(?:^|/|[a-z0-9])(?:Payment|Wallet|Ledger|Escrow|Payout|Refund|Settlement|Reconciliation|Currency|Money|Accounting|Finance|Fee|Transaction|Order)(?=[A-Z])"
      ],
      extensions: [".ts", ".tsx"]
    },
    {
      id: "deployed-migrations",
      type: "base-prefix",
      prefixes: ["backend/migrations/"],
      extensions: [".sql"]
    }
  ],
  mixedFiles: [
    {
      path: "backend/src/common/validation.ts",
      protectRenameDelete: true,
      symbols: [
        {
          id: "money-conversion",
          start: "^const MONEY_PATTERN\\b",
          end: "^export const SAFE_AFTER\\b"
        }
      ],
      anchors: []
    },
    {
      path: "backend/src/modules/auth/auth.routes.ts",
      protectRenameDelete: true,
      symbols: [],
      anchors: [
        {
          id: "registration-wallet",
          pattern: "insert into wallets\\(user_id, currency\\)",
          expected: 1,
          before: 1,
          after: 1
        }
      ]
    },
    {
      path: "backend/src/modules/jobs/queue.ts",
      protectRenameDelete: true,
      symbols: [
        {
          id: "escrow-worker",
          start: "^async function processEscrowRelease\\(",
          end: "^async function processNotification\\("
        }
      ],
      anchors: []
    },
    {
      path: "backend/src/app.ts",
      protectRenameDelete: true,
      symbols: [],
      anchors: [
        {
          id: "financial-route-prefix",
          pattern: "[\"']/payments[\"']",
          expected: 1,
          before: 1,
          after: 1
        }
      ]
    },
    {
      path: "backend/src/modules/marketplace/marketplace.sql.ts",
      protectRenameDelete: true,
      symbols: [],
      anchors: [],
      fragments: [
        {
          id: "marketplace-product-financial-sql-identifiers",
          pattern: "(?:\\b[a-z][a-z0-9_]*\\.)?(?:[a-z][a-z0-9_]*_cents(?:_[a-z0-9_]+)?|currency|payment_provider|payment_reference|resolution_operation_id)\\b",
          expected: 3
        },
        {
          id: "marketplace-product-financial-code-identifiers",
          pattern: "\\b(?:[A-Za-z][A-Za-z0-9]*Cents|MoneyCents|CurrencyCode|lockEscrow|releaseEscrow|refundEscrow|escrow_release|dispute_timer|reconciliation_daily)\\b",
          expected: 2
        },
        {
          id: "marketplace-product-financial-table-identifiers",
          pattern: "\\b(?:wallets|wallet_topups|platform_wallets|currency_rates|ledger_accounts|ledger_entries|ledger_lines|orders|order_events|payments?|payment_attempts|payouts|transactions|refunds?|settlements?|commissions?|escrows?)\\b",
          expected: 0
        },
        {
          id: "marketplace-product-financial-module-or-route-identifiers",
          pattern: "(?:domain/money|payments/|currencies/|orders/(?:ledger|accounting|order-transition|orders\\.dto)|users/wallet\\.service|admin/(?:admin-finance|admin-payouts)\\.routes|admin/reconciliation\\.service|disputes/dispute-resolution\\.service|[\"'`](?:/orders|/payments|/users/me/wallet|/admin/(?:finance|payouts|transactions|ledger|reconciliation|jobs|orders)|/currencies)(?=[/?#\"'`]|$)|/disputes/[^\\s\"'`]*?/resolve(?=[/?#\"'`]|$))",
          expected: 0
        },
        {
          id: "marketplace-product-financial-select-items",
          pattern: "(?:^|,)\\s*p\\.(?:(?:[a-z][a-z0-9_]*_cents|currency|payment_provider|payment_reference)(?:\\s+as\\s+\"[A-Za-z][A-Za-z0-9]*\")?)\\s*(?=,)",
          expected: 3
        }
      ]
    },
    {
      path: "frontend/i18n/locales/en/notifications.json",
      protectRenameDelete: true,
      symbols: [
        {
          id: "frontend-financial-order-lifecycle",
          start: "^\\s*\"orderCreated\": \\{$",
          end: "^\\s*\"reviewCreated\": \\{$"
        },
        {
          id: "frontend-financial-dispute-notifications",
          start: "^\\s*\"orderDisputed\": \\{$",
          end: "^\\s*\"accountWarned\": \\{$"
        }
      ],
      anchors: [
        {
          id: "frontend-reconciliation-notification",
          pattern: "^\\s*\"reconciliationMismatch\": \\{$",
          expected: 1,
          before: 0,
          after: 2
        }
      ]
    }
  ],
  changedContentRules: [
    {
      id: "changed-financial-backend",
      prefixes: ["backend/src/"],
      excludePaths: ["backend/src/modules/marketplace/marketplace.sql.ts"],
      extensions: [".ts"],
      patterns: [
        "(?:domain/money|currencies/|orders/ledger\\.service|users/wallet\\.service|\\b(?:wallets|ledger_entries|transactions)\\b|\\b[a-z][a-z0-9_]*_cents\\b)"
      ]
    },
    {
      id: "changed-financial-frontend",
      prefixes: ["frontend/"],
      extensions: [".ts", ".tsx"],
      patterns: [
        "(?:(?:@/|\\./|(?:\\.\\./)+)lib/(?:money|currency)|\\./(?:money|currency)|[\"'`](?:/orders|/payments|/users/me/wallet|/admin/(?:finance|payouts|transactions|ledger|reconciliation|jobs|orders)|/currencies)(?=[/?#\"'`]|$)|/disputes/[^\\s\"'`]*?/resolve(?=[/?#\"'`]|$)|WireMoneyCents|priceCents|amountCents|useMoney\\()"
      ],
      contextPatterns: [
        {
          pattern: "/marketplace/products(?:/[^\\s\"'`]*)?[\\s\\S]{0,800}method:\\s*[\"'](?:POST|PATCH)",
          signals: ["/marketplace/products", "method:\\s*[\"'](?:POST|PATCH)"]
        }
      ]
    },
    {
      id: "changed-financial-test",
      prefixes: ["backend/test/", "frontend/test/", "e2e/tests/", "load-tests/"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".mts", ".cts"],
      patterns: [
        "(?:priceCents|amountCents|MoneyCents|\\b[a-z][a-z0-9_]*_cents\\b|\\b(?:wallets|ledger_entries|transactions)\\b|[\"'`](?:/orders|/payments|/users/me/wallet|/admin/(?:finance|payouts|transactions|ledger|reconciliation|jobs|orders)|/currencies)(?=[/?#\"'`]|$)|/disputes/[^\\s\"'`]*?/resolve(?=[/?#\"'`]|$))"
      ]
    },
    {
      id: "changed-financial-shared-contracts",
      prefixes: ["shared/contracts/"],
      extensions: [".ts"],
      patterns: [
        "(?:\\./money|\\./order|MoneyCents|CurrencyCode|priceCents|amountCents|feeCents)"
      ]
    },
    {
      id: "changed-financial-operations",
      prefixes: ["scripts/", "backend/scripts/"],
      extensions: [".ts", ".js", ".mjs", ".ps1", ".sql"],
      patterns: [
        "(?:domain/money|modules/(?:payments|currencies)/|\\b(?:wallets|ledger_entries|transactions)\\b|\\b[a-z][a-z0-9_]*_cents\\b)"
      ]
    }
  ],
  newFileRules: [
    {
      id: "new-financial-migration",
      prefixes: ["backend/migrations/"],
      extensions: [".sql"],
      patterns: [
        "\\b(?:wallets|ledger_entries)\\b",
        "\\b[a-z][a-z0-9_]*_cents(?:_[a-z0-9_]+)?\\b",
        "\\b(?:orders|order_events|payments?|payment_attempts|refunds?|settlements?|fees?|commissions?|escrows?|transactions)\\b",
        "\\b(?:create|alter)\\s+table\\s+(?:settlements?|refunds?|orders)\\b"
      ]
    },
    {
      id: "new-financial-worker",
      prefixes: ["backend/src/modules/jobs/"],
      extensions: [".ts"],
      patterns: [
        "orders/ledger\\.service",
        "\"escrow_release\"",
        "(?:domain/money|\\b(?:wallets|wallet_topups|ledger_entries|ledger_lines|payouts|transactions)\\b)"
      ]
    },
    {
      id: "new-financial-test",
      prefixes: ["backend/test/", "frontend/test/", "e2e/tests/", "load-tests/"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".mts", ".cts"],
      patterns: [
        "(?:modules/payments/|orders/ledger\\.service|users/wallet\\.service|domain/money|lockEscrow|releaseEscrow|refundEscrow|escrow_release|ledger_entries|priceCents|oldPriceCents|amountCents|completedRevenueCents|feeCents|CurrencyCode|MoneyCents)",
        "[\"'`](?:/orders|/payments|/users/me/wallet|/admin/(?:finance|payouts|transactions|ledger|reconciliation|jobs|orders)|/currencies)(?=[/?#\"'`]|$)",
        "/disputes/[^\\s\"'`]*?/resolve(?=[/?#\"'`]|$)"
      ]
    },
    {
      id: "new-financial-frontend",
      prefixes: ["frontend/"],
      extensions: [".ts", ".tsx"],
      patterns: [
        "(?:(?:@/|\\./|(?:\\.\\./)+)lib/(?:money|currency|liqpay|monobank|wayforpay)|\\./(?:money|currency|liqpay|monobank|wayforpay)|WireMoneyCents|MoneyCents|CurrencyCode|priceCents|oldPriceCents|amountCents|feeCents|completedRevenueCents|moneyCentsToMajorUnits|majorUnitsToMoneyCents|useMoney\\()",
        "[\"'`](?:/orders|/payments|/users/me/wallet|/admin/(?:finance|payouts|transactions|ledger|reconciliation|jobs|orders)|/currencies)(?=[/?#\"'`]|$)",
        "/disputes/[^\\s\"'`]*?/resolve(?=[/?#\"'`]|$)",
        "/marketplace/products(?:/[^\\s\"'`]*)?[\\s\\S]{0,800}method:\\s*[\"'](?:POST|PATCH)"
      ]
    }
  ]
};

const initialFiles = {
  "backend/src/domain/money.ts": "export const cents = 100;\n",
  "backend/src/modules/users/wallet.service.ts": "export const wallet = 'stable';\n",
  "backend/src/modules/payments/payment.ts": "export const payment = 'stable';\n",
  "backend/src/modules/orders/ledger.service.ts": "export const ledger = 'stable';\n",
  "backend/src/modules/orders/escrow.service.ts": "export const escrow = 'stable';\n",
  "backend/src/modules/payments/refund.service.ts": "export const refund = 'stable';\n",
  "backend/test/ledger.test.ts": "export const ledgerTest = 'stable';\n",
  "backend/migrations/001_initial.sql": "create table profiles(id text);\n",
  "backend/src/common/validation.ts": [
    "export const SAFE_BEFORE = 'editable';",
    "const MONEY_PATTERN = /^\\d+$/;",
    "export function moneyToCents(value) {",
    "  return value * 100;",
    "}",
    "export const SAFE_AFTER = 'editable';",
    ""
  ].join("\n"),
  "backend/src/modules/auth/auth.routes.ts": [
    "export const safeAuth = true;",
    "await tx.query(",
    "  `insert into wallets(user_id, currency) values ($1, 'UAH')`,",
    "  [userId]",
    ");",
    "export const otherAuth = true;",
    ""
  ].join("\n"),
  "backend/src/modules/jobs/queue.ts": [
    "export const SAFE_JOB = 'editable';",
    "async function processEscrowRelease() {",
    "  return 'stable';",
    "}",
    "async function processNotification() {",
    "  return 'editable';",
    "}",
    ""
  ].join("\n"),
  "backend/src/app.ts": [
    "app.use('/profiles', profileRoutes);",
    "app.use('/payments', paymentRoutes);",
    "app.use('/storage', storageRoutes);",
    ""
  ].join("\n"),
  "backend/src/modules/marketplace/marketplace.sql.ts": [
    "export const productSelect = `",
    "  select p.id, p.title, p.description, p.price_cents as \"priceCents\", p.currency, p.stock,",
    "         p.delivery_type as \"deliveryType\", p.product_type as \"productType\", p.old_price_cents as \"oldPriceCents\",",
    "  from products p",
    "  join categories c on c.id = p.category_id",
    "`;",
    ""
  ].join("\n"),
  "frontend/i18n/locales/en/notifications.json": [
    "{",
    "  \"notifications\": {",
    "    \"orderCreated\": {",
    "      \"title\": \"New order\"",
    "    },",
    "    \"orderPaid\": {",
    "      \"title\": \"Payment received\"",
    "    },",
    "    \"reviewCreated\": {",
    "      \"title\": \"New review\"",
    "    },",
    "    \"orderDisputed\": {",
    "      \"title\": \"Dispute opened\"",
    "    },",
    "    \"disputeResolved\": {",
    "      \"title\": \"Dispute resolved\"",
    "    },",
    "    \"accountWarned\": {",
    "      \"title\": \"Warning\"",
    "    },",
    "    \"reconciliationMismatch\": {",
    "      \"title\": \"Mismatch\",",
    "      \"body\": \"Check finance\"",
    "    }",
    "  }",
    "}",
    ""
  ].join("\n"),
  "backend/src/modules/storage/storage.routes.ts": "export const storage = true;\n",
  "frontend/app/profile/page.tsx": "export default function Profile() { return null; }\n",
  "frontend/middleware.ts": "export const middleware = true;\n",
  "frontend/hooks/catalog.ts": "export const list = () => apiFetch('/marketplace/products', { method: 'GET' });\n",
  "frontend/test/profile.test.tsx": "export const profileTest = true;\n",
  "shared/contracts/common.ts": "export type Common = { id: string };\n",
  "frontend/styles/layout.css": ".layout { balance: initial; }\n",
  "docs/plan.md": "baseline\n",
  "notes/path with spaces.txt": "baseline\n"
};

function run(repo, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    ...options
  });
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed (${result.status}): ${result.stderr}`);
  }
  return result.stdout.trim();
}

function filePath(repo, repoPath) {
  return join(repo, ...repoPath.split("/"));
}

function writeRepoFile(repo, repoPath, content) {
  const target = filePath(repo, repoPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function readRepoFile(repo, repoPath) {
  return readFileSync(filePath(repo, repoPath), "utf8");
}

function createRepository() {
  const repo = mkdtempSync(join(tmpdir(), "financial-freeze-"));
  run(repo, ["init", "--quiet"]);
  run(repo, ["config", "user.email", "guard@example.invalid"]);
  run(repo, ["config", "user.name", "Freeze Guard Test"]);
  run(repo, ["config", "core.autocrlf", "false"]);
  run(repo, ["config", "core.filemode", "false"]);
  for (const [repoPath, content] of Object.entries(initialFiles)) writeRepoFile(repo, repoPath, content);
  writeRepoFile(repo, TEST_CONFIG_PATH, `${JSON.stringify(testConfig, null, 2)}\n`);
  run(repo, ["add", "--all"]);
  run(repo, ["commit", "--quiet", "-m", "baseline"]);
  return { repo, base: run(repo, ["rev-parse", "HEAD"]) };
}

function withRepository(callback) {
  const state = createRepository();
  try {
    return callback(state);
  } finally {
    rmSync(state.repo, { recursive: true, force: true });
  }
}

function check(repo, base, configPath = TEST_CONFIG_PATH) {
  return checkFinancialFreeze({ repoRoot: repo, baseRef: base, configPath });
}

function assertViolation(result, ruleId) {
  assert.ok(result.violations.some((item) => item.ruleId === ruleId), `expected violation ${ruleId}`);
}

test("clean repository passes", () =>
  withRepository(({ repo, base }) => {
    assert.deepEqual(check(repo, base).violations, []);
  }));

for (const [label, repoPath] of [
  ["payment", "backend/src/modules/payments/payment.ts"],
  ["wallet", "backend/src/modules/users/wallet.service.ts"],
  ["ledger", "backend/src/modules/orders/ledger.service.ts"],
  ["escrow", "backend/src/modules/orders/escrow.service.ts"],
  ["refund", "backend/src/modules/payments/refund.service.ts"],
  ["financial test", "backend/test/ledger.test.ts"]
]) {
  test(`${label} file modification fails`, () =>
    withRepository(({ repo, base }) => {
      writeRepoFile(repo, repoPath, `${readRepoFile(repo, repoPath)}// changed\n`);
      assert.ok(check(repo, base).violations.length > 0);
    }));
}

test("frozen file addition, deletion, and rename fail", () => {
  withRepository(({ repo, base }) => {
    writeRepoFile(repo, "backend/src/modules/payments/new-provider.ts", "export const provider = true;\n");
    assertViolation(check(repo, base), "financial-domains");
  });
  withRepository(({ repo, base }) => {
    writeRepoFile(repo, "backend/src/modules/payments/uppercase.TS", "export const provider = true;\n");
    assertViolation(check(repo, base), "financial-domains");
  });
  withRepository(({ repo, base }) => {
    rmSync(filePath(repo, "backend/src/modules/users/wallet.service.ts"));
    assertViolation(check(repo, base), "core-financial-files");
  });
  withRepository(({ repo, base }) => {
    renameSync(
      filePath(repo, "backend/src/modules/users/wallet.service.ts"),
      filePath(repo, "backend/src/modules/users/wallet-renamed.service.ts")
    );
    assertViolation(check(repo, base), "core-financial-files");
  });
});

test("rename into a frozen prefix fails", () =>
  withRepository(({ repo, base }) => {
    writeRepoFile(repo, "backend/src/profile-helper.ts", "export const helper = true;\n");
    run(repo, ["add", "backend/src/profile-helper.ts"]);
    run(repo, ["commit", "--quiet", "-m", "add helper"]);
    renameSync(filePath(repo, "backend/src/profile-helper.ts"), filePath(repo, "backend/src/modules/payments/new-helper.ts"));
    assertViolation(check(repo, base), "financial-domains");
  }));

test("new financial-looking code path fails while similarly named documentation passes", () => {
  withRepository(({ repo, base }) => {
    writeRepoFile(repo, "frontend/lib/WalletPanel.tsx", "export const helper = true;\n");
    assertViolation(check(repo, base), "financial-camelcase-path-names");
  });
  withRepository(({ repo, base }) => {
    writeRepoFile(repo, "docs/wallet-notes.md", "documentation only\n");
    assert.deepEqual(check(repo, base).violations, []);
  });
});

test("financial worker symbol and new worker wiring fail while a nearby safe hunk passes", () => {
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "backend/src/modules/jobs/queue.ts",
      readRepoFile(repo, "backend/src/modules/jobs/queue.ts").replace("return 'stable'", "return 'changed'")
    );
    assertViolation(check(repo, base), "escrow-worker");
  });
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "backend/src/modules/jobs/queue.ts",
      readRepoFile(repo, "backend/src/modules/jobs/queue.ts").replace("SAFE_JOB = 'editable'", "SAFE_JOB = 'changed'")
    );
    assert.deepEqual(check(repo, base).violations, []);
  });
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "backend/src/modules/jobs/queue-extra.ts",
      "import { releaseEscrow } from '../orders/ledger.service.js';\nexport const name = 'neutral';\n"
    );
    assertViolation(check(repo, base), "new-financial-worker");
  });
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "backend/src/modules/jobs/billing-runner.ts",
      "export async function run(pool) { await pool.query('update wallets set balance_cents = 0'); }\n"
    );
    assertViolation(check(repo, base), "new-financial-worker");
  });
});

test("a neutral-name test that exercises a financial endpoint fails", () =>
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "backend/test/regression.test.ts",
      "test('creates a purchase', async () => request(app).post('/orders').send({ productId: 'p' }));\n"
    );
    assertViolation(check(repo, base), "new-financial-test");
  }));

test("a neutral-name test that asserts a financial contract fails", () =>
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "frontend/test/card-regression.test.tsx",
      "expect(product.priceCents).toBe('12500');\n"
    );
    assertViolation(check(repo, base), "new-financial-test");
  }));

test("a neutral-name frontend file that adds financial behavior fails", () =>
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "frontend/components/CheckoutButton.tsx",
      "export async function checkout() { return apiFetch('/orders', { method: 'POST' }); }\n"
    );
    assertViolation(check(repo, base), "new-financial-frontend");
  }));

test("a neutral-name frontend file that renders a financial wire field fails", () =>
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "frontend/components/ValueCell.tsx",
      "export function ValueCell({ product }) { return <span>{product.priceCents}</span>; }\n"
    );
    assertViolation(check(repo, base), "new-financial-frontend");
  }));

test("financial code added to an existing neutral backend file fails", () =>
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "backend/src/modules/storage/storage.routes.ts",
      "export async function storage(pool) { await pool.query('update wallets set balance_cents = 0'); }\n"
    );
    assertViolation(check(repo, base), "changed-financial-backend");
  }));

test("a frozen currency import added to an existing neutral backend file fails", () =>
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "backend/src/modules/storage/storage.routes.ts",
      "import { getRates } from '../currencies/currency.service.js';\nexport const storage = getRates;\n"
    );
    assertViolation(check(repo, base), "changed-financial-backend");
  }));

test("financial endpoints with query strings added to existing frontend files fail", () =>
  withRepository(({ repo, base }) => {
    for (const endpoint of [
      "'/currencies?base=UAH'",
      "'/admin/jobs?name=reconciliation_daily'",
      "`/disputes/${id}/resolve?force=true`"
    ]) {
      writeRepoFile(
        repo,
        "frontend/app/profile/page.tsx",
        `export async function action() { return apiFetch(${endpoint}); }\n`
      );
      assertViolation(check(repo, base), "changed-financial-frontend");
    }
  }));

test("a relative financial import added to an existing frontend file fails", () =>
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "frontend/app/profile/page.tsx",
      "import { money as neutralAlias } from '../../lib/money';\nexport default neutralAlias;\n"
    );
    assertViolation(check(repo, base), "changed-financial-frontend");
    writeRepoFile(repo, "frontend/app/profile/page.tsx", "export default function Profile() { return null; }\n");
    writeRepoFile(
      repo,
      "frontend/middleware.ts",
      "import { money as neutralAlias } from './lib/money';\nexport default neutralAlias;\n"
    );
    assertViolation(check(repo, base), "changed-financial-frontend");
  }));

test("new marketplace write wiring fails outside the known seller files", () =>
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "frontend/hooks/useQuickLister.ts",
      [
        "export async function list(payload) {",
        "  return apiFetch('/marketplace/products', {",
        "    method: 'POST',",
        "    body: JSON.stringify(payload)",
        "  });",
        "}",
        ""
      ].join("\n")
    );
    assertViolation(check(repo, base), "changed-financial-frontend");
  }));

test("changing an existing marketplace read into a write fails with unchanged endpoint context", () =>
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "frontend/hooks/catalog.ts",
      "export const list = () => apiFetch('/marketplace/products', { method: 'POST' });\n"
    );
    assertViolation(check(repo, base), "changed-financial-frontend");
  }));

test("financial shared contracts and operational scripts fail at neutral paths", () =>
  withRepository(({ repo, base }) => {
    writeRepoFile(repo, "shared/contracts/common.ts", "export type Total = MoneyCents;\n");
    assertViolation(check(repo, base), "changed-financial-shared-contracts");
    writeRepoFile(repo, "shared/contracts/common.ts", "export type Common = { id: string };\n");
    writeRepoFile(repo, "scripts/repair.mjs", "await pool.query('update wallets set balance_cents = 0');\n");
    assertViolation(check(repo, base), "changed-financial-operations");
  }));

test("financial admin, currency, and dispute tests fail at neutral paths", () =>
  withRepository(({ repo, base }) => {
    for (const endpoint of [
      "'/admin/finance?period=day'",
      "'/currencies?base=UAH'",
      "`/disputes/${id}/resolve`"
    ]) {
      writeRepoFile(
        repo,
        "frontend/test/profile.test.tsx",
        `test('financial endpoint', () => apiFetch(${endpoint}));\n`
      );
      assertViolation(check(repo, base), "changed-financial-test");
    }
    writeRepoFile(repo, "backend/test/runtime-regression.test.mjs", "test('/currencies?base=UAH');\n");
    assertViolation(check(repo, base), "changed-financial-test");
  }));

test("a neutral-name backend file with financial SQL fails", () =>
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "backend/src/modules/users/summary.ts",
      "export const query = 'select amount_cents from transactions';\n"
    );
    assertViolation(check(repo, base), "changed-financial-backend");
  }));

test("removing financial code from an otherwise neutral file fails", () =>
  withRepository(({ repo }) => {
    writeRepoFile(
      repo,
      "backend/src/modules/storage/storage.routes.ts",
      "export const query = 'select amount_cents from transactions';\n"
    );
    run(repo, ["add", "backend/src/modules/storage/storage.routes.ts"]);
    run(repo, ["commit", "--quiet", "-m", "financial baseline"]);
    const base = run(repo, ["rev-parse", "HEAD"]);
    writeRepoFile(repo, "backend/src/modules/storage/storage.routes.ts", "export const storage = true;\n");
    assertViolation(check(repo, base), "changed-financial-backend");
  }));

test("renaming financial code out of a watched prefix fails without content hunks", () =>
  withRepository(({ repo }) => {
    writeRepoFile(
      repo,
      "backend/src/modules/storage/storage.routes.ts",
      "export const query = 'select amount_cents from transactions';\n"
    );
    run(repo, ["add", "backend/src/modules/storage/storage.routes.ts"]);
    run(repo, ["commit", "--quiet", "-m", "financial baseline"]);
    const base = run(repo, ["rev-parse", "HEAD"]);
    mkdirSync(filePath(repo, "tools"), { recursive: true });
    renameSync(
      filePath(repo, "backend/src/modules/storage/storage.routes.ts"),
      filePath(repo, "tools/summary.ts")
    );
    assertViolation(check(repo, base), "changed-financial-backend");
  }));

test("a shadow route inserted before financial wiring fails", () =>
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "backend/src/app.ts",
      readRepoFile(repo, "backend/src/app.ts").replace(
        "app.use('/payments', paymentRoutes);",
        "app.use('/payments', (_req, res) => res.sendStatus(404));\napp.use('/payments', paymentRoutes);"
      )
    );
    assertViolation(check(repo, base), "financial-route-prefix");
  }));

test("deployed migration modification fails", () =>
  withRepository(({ repo, base }) => {
    writeRepoFile(repo, "backend/migrations/001_initial.sql", "create table changed(id text);\n");
    assertViolation(check(repo, base), "deployed-migrations");
  }));

test("new nonfinancial migration passes but financial migration fails", () => {
  withRepository(({ repo, base }) => {
    writeRepoFile(repo, "backend/migrations/002_profile.sql", "alter table profiles add column bio text;\n");
    assert.deepEqual(check(repo, base).violations, []);
  });
  withRepository(({ repo, base }) => {
    writeRepoFile(repo, "backend/migrations/002_ledger.sql", "alter table ledger_entries add column note text;\n");
    assertViolation(check(repo, base), "new-financial-migration");
  });
  withRepository(({ repo, base }) => {
    writeRepoFile(repo, "backend/migrations/002_columns.sql", "alter table products add column amount_cents_v2 bigint;\n");
    assertViolation(check(repo, base), "new-financial-migration");
  });
  withRepository(({ repo, base }) => {
    writeRepoFile(repo, "backend/migrations/002_records.sql", "create table settlements(id uuid primary key);\n");
    assertViolation(check(repo, base), "new-financial-migration");
  });
  withRepository(({ repo, base }) => {
    writeRepoFile(repo, "backend/migrations/002_indexes.sql", "create index idx_recent on orders(created_at);\n");
    assertViolation(check(repo, base), "new-financial-migration");
  });
  withRepository(({ repo, base }) => {
    writeRepoFile(repo, "backend/migrations/002_more_indexes.sql", "create index idx_tx on transactions(created_at);\n");
    assertViolation(check(repo, base), "new-financial-migration");
  });
});

test("auth, profile, storage, docs, spaces, and CSS word balance remain allowed", () =>
  withRepository(({ repo, base }) => {
    writeRepoFile(repo, "frontend/app/profile/page.tsx", "export default function Profile() { return <main />; }\n");
    writeRepoFile(repo, "backend/src/modules/storage/storage.routes.ts", "export const storage = 'changed';\n");
    writeRepoFile(repo, "docs/plan.md", "changed\n");
    writeRepoFile(repo, "notes/path with spaces.txt", "changed\n");
    writeRepoFile(repo, "frontend/styles/layout.css", ".layout { balance: stable; }\n");
    writeRepoFile(repo, "backend/src/modules/outbox/transactional-outbox.ts", "export const event = 'safe';\n");
    writeRepoFile(repo, "frontend/components/FeedbackPanel.tsx", "export const FeedbackPanel = () => null;\n");
    writeRepoFile(repo, "backend/src/modules/auth/auth.routes.ts", readRepoFile(repo, "backend/src/modules/auth/auth.routes.ts").replace("safeAuth = true", "safeAuth = false"));
    assert.deepEqual(check(repo, base).violations, []);
  }));

test("financial symbol edits and insertions in a mixed file fail", () => {
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "backend/src/common/validation.ts",
      readRepoFile(repo, "backend/src/common/validation.ts").replace("/^\\d+$/", "/^\\d+(?:\\.\\d{1,2})?$/")
    );
    assertViolation(check(repo, base), "money-conversion");
  });
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "backend/src/common/validation.ts",
      readRepoFile(repo, "backend/src/common/validation.ts").replace("  return value * 100;", "  const normalized = value;\n  return normalized * 100;")
    );
    assertViolation(check(repo, base), "money-conversion");
  });
});

test("nonfinancial hunk in a mixed file passes", () =>
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "backend/src/common/validation.ts",
      `// nonfinancial preface\n${readRepoFile(repo, "backend/src/common/validation.ts").replace(
        "SAFE_BEFORE = 'editable'",
        "SAFE_BEFORE = 'changed'"
      )}`
    );
    assert.deepEqual(check(repo, base).violations, []);
  }));

test("marketplace select protects money columns without freezing catalog fields", () => {
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "backend/src/modules/marketplace/marketplace.sql.ts",
      readRepoFile(repo, "backend/src/modules/marketplace/marketplace.sql.ts")
        .replace(
          "p.id, p.title, p.description, p.price_cents as \"priceCents\", p.currency, p.stock,",
          "p.id, p.display_title, p.summary, p.price_cents as \"priceCents\", p.currency, p.inventory_count,"
        )
        .replace("p.product_type as \"productType\"", "p.listing_type as \"productType\"")
    );
    assert.deepEqual(check(repo, base).violations, []);
  });
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "backend/src/modules/marketplace/marketplace.sql.ts",
      readRepoFile(repo, "backend/src/modules/marketplace/marketplace.sql.ts").replace("p.price_cents", "p.price_minor")
    );
    assertViolation(check(repo, base), "marketplace-product-financial-sql-identifiers");
  });
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "backend/src/modules/marketplace/marketplace.sql.ts",
      readRepoFile(repo, "backend/src/modules/marketplace/marketplace.sql.ts").replace(
        "p.price_cents as \"priceCents\"",
        "0 + p.price_cents as \"priceCents\""
      )
    );
    assertViolation(check(repo, base), "marketplace-product-financial-select-items");
  });
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "backend/src/modules/marketplace/marketplace.sql.ts",
      readRepoFile(repo, "backend/src/modules/marketplace/marketplace.sql.ts").replace(
        "p.currency, p.stock",
        "p.currency, p.fee_cents as \"feeCents\", p.stock"
      )
    );
    assertViolation(check(repo, base), "marketplace-product-financial-sql-identifiers");
  });
  for (const [from, to, ruleId] of [
    ["p.currency", "p.currency_code", "marketplace-product-financial-sql-identifiers"],
    ["p.old_price_cents as \"oldPriceCents\"", "p.old_price_cents as \"previousPriceCents\"", "marketplace-product-financial-select-items"],
    ["p.currency, p.stock", "p.currency, p.currency, p.stock", "marketplace-product-financial-sql-identifiers"],
    ["p.currency, p.stock", "p.currency, u.fee_cents as \"sellerFeeCents\", p.stock", "marketplace-product-financial-sql-identifiers"],
    ["p.currency, p.stock", "p.currency, 0 as \"feeCents\", p.stock", "marketplace-product-financial-code-identifiers"],
    ["  from products p", "  from products p join wallets w on w.user_id = p.user_id", "marketplace-product-financial-table-identifiers"]
  ]) {
    withRepository(({ repo, base }) => {
      writeRepoFile(
        repo,
        "backend/src/modules/marketplace/marketplace.sql.ts",
        readRepoFile(repo, "backend/src/modules/marketplace/marketplace.sql.ts").replace(from, to)
      );
      assertViolation(check(repo, base), ruleId);
    });
  }
});

test("notification rules allow reviews and later neutral notices but protect financial copy", () => {
  withRepository(({ repo, base }) => {
    const source = readRepoFile(repo, "frontend/i18n/locales/en/notifications.json")
      .replace("New review", "Fresh review")
      .replace(
        "      \"body\": \"Check finance\"\n    }\n  }\n}",
        "      \"body\": \"Check finance\"\n    },\n    \"systemNotice\": {\n      \"title\": \"Maintenance\"\n    }\n  }\n}"
      );
    writeRepoFile(repo, "frontend/i18n/locales/en/notifications.json", source);
    assert.deepEqual(check(repo, base).violations, []);
  });
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "frontend/i18n/locales/en/notifications.json",
      readRepoFile(repo, "frontend/i18n/locales/en/notifications.json").replace(
        "Payment received",
        "Payment accepted"
      )
    );
    assertViolation(check(repo, base), "frontend-financial-order-lifecycle");
  });
});

test("deleted or duplicated mixed-file anchor fails", () => {
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "backend/src/common/validation.ts",
      readRepoFile(repo, "backend/src/common/validation.ts").replace("const MONEY_PATTERN = /^\\d+$/;\n", "")
    );
    assertViolation(check(repo, base), "money-conversion");
  });
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "backend/src/common/validation.ts",
      readRepoFile(repo, "backend/src/common/validation.ts").replace(
        "const MONEY_PATTERN = /^\\d+$/;",
        "const MONEY_PATTERN = /^\\d+$/;\nexport const SAFE_AFTER = 'forged boundary';"
      )
    );
    assertViolation(check(repo, base), "money-conversion");
  });
  withRepository(({ repo, base }) => {
    writeRepoFile(
      repo,
      "backend/src/modules/auth/auth.routes.ts",
      `${readRepoFile(repo, "backend/src/modules/auth/auth.routes.ts")}insert into wallets(user_id, currency) values ('x', 'UAH');\n`
    );
    assertViolation(check(repo, base), "registration-wallet");
  });
});

test("mixed file deletion and rename fail", () => {
  withRepository(({ repo, base }) => {
    rmSync(filePath(repo, "backend/src/common/validation.ts"));
    assert.ok(check(repo, base).violations.some((item) => item.ruleId.startsWith("mixed-file-lifecycle:")));
  });
  withRepository(({ repo, base }) => {
    renameSync(filePath(repo, "backend/src/common/validation.ts"), filePath(repo, "backend/src/common/validation-renamed.ts"));
    assert.ok(check(repo, base).violations.some((item) => item.ruleId.startsWith("mixed-file-lifecycle:")));
  });
});

test("committed violation is detected", () =>
  withRepository(({ repo, base }) => {
    writeRepoFile(repo, "backend/src/modules/payments/payment.ts", "export const payment = 'committed change';\n");
    run(repo, ["add", "--all"]);
    run(repo, ["commit", "--quiet", "-m", "bad financial change"]);
    assertViolation(check(repo, base), "financial-domains");
  }));

test("staged violation hidden by an unstaged restore is detected", () =>
  withRepository(({ repo, base }) => {
    const repoPath = "backend/src/modules/payments/payment.ts";
    const original = readRepoFile(repo, repoPath);
    writeRepoFile(repo, repoPath, "export const payment = 'staged change';\n");
    run(repo, ["add", repoPath]);
    writeRepoFile(repo, repoPath, original);
    assertViolation(check(repo, base), "financial-domains");
  }));

test("committed violation hidden by a staged restore is detected", () =>
  withRepository(({ repo, base }) => {
    const repoPath = "backend/src/modules/payments/payment.ts";
    const original = readRepoFile(repo, repoPath);
    writeRepoFile(repo, repoPath, "export const payment = 'committed change';\n");
    run(repo, ["add", repoPath]);
    run(repo, ["commit", "--quiet", "-m", "bad financial change"]);
    writeRepoFile(repo, repoPath, original);
    run(repo, ["add", repoPath]);
    assertViolation(check(repo, base), "financial-domains");
  }));

test("CRLF line endings preserve mixed-file line coordinates", () =>
  withRepository(({ repo }) => {
    const source = readRepoFile(repo, "backend/src/common/validation.ts").replace(/\n/gu, "\r\n");
    writeRepoFile(repo, "backend/src/common/validation.ts", source);
    run(repo, ["add", "backend/src/common/validation.ts"]);
    run(repo, ["commit", "--quiet", "-m", "CRLF baseline"]);
    const base = run(repo, ["rev-parse", "HEAD"]);
    writeRepoFile(
      repo,
      "backend/src/common/validation.ts",
      source.replace("SAFE_BEFORE = 'editable'", "SAFE_BEFORE = 'changed'")
    );
    assert.deepEqual(check(repo, base).violations, []);
  }));

test("unknown, zero, and non-ancestor base refs safe-fail", () => {
  withRepository(({ repo }) => {
    assert.throws(() => check(repo, "missing-ref"), FinancialFreezeSafeFailure);
    assert.throws(() => check(repo, "0000000000000000000000000000000000000000"), FinancialFreezeSafeFailure);
  });
  withRepository(({ repo, base }) => {
    run(repo, ["switch", "--orphan", "unrelated"]);
    writeRepoFile(repo, "unrelated.txt", "unrelated\n");
    run(repo, ["add", "--all"]);
    run(repo, ["commit", "--quiet", "-m", "unrelated"]);
    assert.throws(() => check(repo, base), FinancialFreezeSafeFailure);
  });
});

test("missing and malformed config safe-fail", () => {
  withRepository(({ repo, base }) => {
    assert.throws(() => check(repo, base, "config/missing.json"), FinancialFreezeSafeFailure);
  });
  withRepository(({ repo, base }) => {
    writeRepoFile(repo, TEST_CONFIG_PATH, "{not-json\n");
    assert.throws(() => check(repo, base), FinancialFreezeSafeFailure);
  });
});

test("Windows separators normalize without lowercasing", () => {
  assert.equal(normalizeRepoPath("backend\\src\\Modules\\Money.ts"), "backend/src/Modules/Money.ts");
});

test("name-status and hunk parsers accept NUL records and zero ranges", () => {
  assert.deepEqual(parseNameStatusZ("R100\0old path.ts\0new path.ts\0M\0plain.ts\0"), [
    { status: "R", statusToken: "R100", oldPath: "old path.ts", newPath: "new path.ts" },
    { status: "M", statusToken: "M", oldPath: "plain.ts", newPath: "plain.ts" }
  ]);
  assert.deepEqual(parseZeroContextHunks("@@ -2,0 +3,2 @@\n+x\n+y\n"), [
    { oldStart: 2, oldCount: 0, newStart: 3, newCount: 2 }
  ]);
});

test("config validation rejects unsafe paths and duplicate ids", () => {
  const unsafe = structuredClone(testConfig);
  unsafe.pathRules[0].paths[0] = "../outside.ts";
  assert.throws(() => validateConfig(unsafe), FinancialFreezeSafeFailure);

  const duplicate = structuredClone(testConfig);
  duplicate.pathRules[1].id = duplicate.pathRules[0].id;
  assert.throws(() => validateConfig(duplicate), FinancialFreezeSafeFailure);
});
