import { randomUUID } from "node:crypto";
import {
  expect,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Page,
  type WebSocket
} from "@playwright/test";

export const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";
export const apiURL = process.env.E2E_API_URL ?? `${baseURL}/api`;
export const runId = sanitizeRunId(process.env.E2E_RUN_ID ?? randomUUID());
export const defaultPassword = "Password123!";

type ApiOptions = {
  data?: unknown;
  headers?: Record<string, string>;
};

export type Actor = {
  context: BrowserContext;
  email: string;
  password: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    role: "user" | "moderator" | "admin";
    emailVerified?: boolean;
  };
};

export type ProductFixture = {
  id: string;
  title: string;
  sectionId: string;
};

export async function rawApi(
  context: BrowserContext,
  method: string,
  path: string,
  options: ApiOptions = {}
): Promise<APIResponse> {
  const headers = { ...options.headers };
  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
    const csrf = (await context.cookies(baseURL)).find(
      (cookie) => cookie.name === "csrf_token"
    );
    if (csrf) headers["x-csrf-token"] = csrf.value;
  }
  return context.request.fetch(`${apiURL}${path}`, {
    method,
    data: options.data,
    headers,
    failOnStatusCode: false
  });
}

export async function api<T>(
  context: BrowserContext,
  method: string,
  path: string,
  options: ApiOptions = {}
): Promise<T> {
  const response = await rawApi(context, method, path, options);
  if (!response.ok()) {
    throw new Error(
      `${method} ${path} returned ${response.status()}: ${await response.text()}`
    );
  }
  return (await response.json()) as T;
}

export async function registerVerifiedActor(
  browser: Browser,
  label: string,
  password = defaultPassword
): Promise<Actor> {
  const context = await browser.newContext();
  const suffix = `${runId}-${label}-${randomUUID().slice(0, 8)}`;
  const email = `${suffix}@example.test`;
  const displayName = `${label} ${suffix.slice(-8)}`;
  const registration = await api<{
    user: Actor["user"];
    debugVerificationUrl?: string;
  }>(context, "POST", "/auth/register", {
    data: { email, password, displayName }
  });
  expect(
    registration.debugVerificationUrl,
    "NODE_ENV=test must expose the one-time email verification link"
  ).toBeTruthy();
  const token = new URL(registration.debugVerificationUrl!).searchParams.get("token");
  expect(token).toBeTruthy();
  await api(context, "POST", "/auth/verify-email/confirm", {
    data: { token }
  });
  const me = await api<{ user: Actor["user"] }>(context, "GET", "/auth/me");
  expect(me.user.emailVerified).toBe(true);
  return { context, email, password, user: me.user };
}

export async function loginActor(
  browser: Browser,
  email: string,
  password = defaultPassword
): Promise<Actor> {
  const context = await browser.newContext();
  const result = await api<{ user: Actor["user"] }>(
    context,
    "POST",
    "/auth/login",
    { data: { email, password } }
  );
  return { context, email, password, user: result.user };
}

export function loginAdmin(browser: Browser) {
  return loginActor(
    browser,
    process.env.E2E_ADMIN_EMAIL ?? "admin@example.com",
    process.env.E2E_ADMIN_PASSWORD ?? defaultPassword
  );
}

type CatalogField = {
  key: string;
  type: string;
  required: boolean;
  options?: string[];
  min?: number;
  max?: number;
};

type CatalogSection = {
  id: string;
  allowedDeliveryTypes: string[];
};

type CatalogGroup = {
  items: Array<{ sections: CatalogSection[] }>;
};

function fieldValue(field: CatalogField): unknown {
  if (field.type === "number") {
    const value = field.min ?? 1;
    return field.max === undefined ? value : Math.min(value, field.max);
  }
  if (field.type === "select") return field.options?.[0] ?? "";
  if (field.type === "multiselect") return field.options?.length ? [field.options[0]] : [];
  if (field.type === "boolean" || field.type === "checkbox") return true;
  return `e2e-${runId}-${field.key}`;
}

export async function createProduct(
  seller: Actor,
  label: string
): Promise<ProductFixture> {
  const catalog = await api<{ groups: CatalogGroup[] }>(
    seller.context,
    "GET",
    "/marketplace/catalog"
  );
  const sections = catalog.groups.flatMap((group) =>
    group.items.flatMap((item) => item.sections)
  );
  expect(sections.length, "the migrated catalog must expose active sections").toBeGreaterThan(0);

  let lastError: unknown;
  for (const section of sections) {
    const schema = await api<{ schema: { fields: CatalogField[] } }>(
      seller.context,
      "GET",
      `/marketplace/catalog/sections/${section.id}/schema`
    );
    const metadata = Object.fromEntries(
      schema.schema.fields
        .filter((field) => field.required)
        .map((field) => [field.key, fieldValue(field)])
    );
    const deliveryType = section.allowedDeliveryTypes.includes("manual")
      ? "manual"
      : section.allowedDeliveryTypes[0];
    if (!deliveryType) continue;
    const title = `E2E ${runId} ${label} ${randomUUID().slice(0, 6)}`;
    try {
      const result = await api<{ id: string }>(
        seller.context,
        "POST",
        "/marketplace/products",
        {
          data: {
            title,
            description: `Deterministic isolated marketplace product for ${runId} and ${label}.`,
            sectionId: section.id,
            price: "19.99",
            currency: "UAH",
            stock: 10,
            deliveryType,
            deliveryTemplate:
              deliveryType === "instant"
                ? `Automated E2E delivery for ${runId}`
                : null,
            metadata
          }
        }
      );
      return { id: result.id, title, sectionId: section.id };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`No active catalog section accepted an E2E product: ${String(lastError)}`);
}

export async function createOrder(
  buyer: Actor,
  productId: string,
  idempotencyKey = randomUUID()
) {
  return api<{ order: { id: string; status: string }; conversationId: string }>(
    buyer.context,
    "POST",
    "/orders",
    {
      headers: { "Idempotency-Key": idempotencyKey },
      data: { productId, quantity: 1 }
    }
  );
}

export async function createPaidDeliveredOrder(
  buyer: Actor,
  seller: Actor,
  productId: string
) {
  const created = await createOrder(buyer, productId);
  await api(buyer.context, "POST", `/payments/test/orders/${created.order.id}/success`);
  await api(seller.context, "POST", `/orders/${created.order.id}/start`);
  await api(seller.context, "POST", `/orders/${created.order.id}/deliver`, {
    data: { deliveryNote: `E2E delivery proof ${runId}` }
  });
  return created;
}

export function waitForConnectedWebSocket(page: Page): Promise<WebSocket> {
  return new Promise((resolve) => {
    page.on("websocket", (socket) => {
      if (!socket.url().includes("/ws")) return;
      socket.on("framereceived", (frame) => {
        if (
          typeof frame.payload === "string" &&
          frame.payload.includes('"type":"connected"')
        ) {
          resolve(socket);
        }
      });
    });
  });
}

export function waitForSocketFrame(
  socket: WebSocket,
  predicate: (payload: string) => boolean,
  timeoutMs = 20_000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for a WebSocket frame`));
    }, timeoutMs);
    socket.on("close", () => {
      clearTimeout(timer);
      reject(new Error("WebSocket closed before the expected frame arrived"));
    });
    socket.on("framereceived", (frame) => {
      if (typeof frame.payload === "string" && predicate(frame.payload)) {
        clearTimeout(timer);
        resolve(frame.payload);
      }
    });
  });
}

export function waitForPageSocketFrame(
  page: Page,
  predicate: (payload: string) => boolean,
  timeoutMs = 20_000
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for a page WebSocket frame`));
    }, timeoutMs);
    page.on("websocket", (socket) => {
      socket.on("framereceived", (frame) => {
        if (
          !settled &&
          typeof frame.payload === "string" &&
          predicate(frame.payload)
        ) {
          settled = true;
          clearTimeout(timer);
          resolve(frame.payload);
        }
      });
    });
  });
}

export async function closeActors(...actors: Array<Actor | undefined>) {
  await Promise.all(actors.filter(Boolean).map((actor) => actor!.context.close()));
}

function sanitizeRunId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 36);
}
