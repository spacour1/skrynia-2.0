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

export async function registerVerifiedActorThroughUi(
  browser: Browser,
  label: string,
  password = defaultPassword
): Promise<Actor> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const suffix = `${runId}-${label}-${randomUUID().slice(0, 8)}`;
  const email = `${suffix}@example.test`;
  const displayName = `${label} ${suffix.slice(-8)}`;

  try {
    await page.goto("/en/register");
    await page.getByPlaceholder("Display name").fill(displayName);
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password").fill(password);
    const registrationResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/auth/register" &&
        response.request().method() === "POST"
    );
    await page
      .getByRole("main")
      .getByRole("button", { name: "Register", exact: true })
      .click();
    const registered = await registrationResponse;
    expect(registered.status()).toBe(201);
    const registration = (await registered.json()) as {
      user: Actor["user"];
      debugVerificationUrl?: string;
    };
    expect(
      registration.debugVerificationUrl,
      "the isolated test runtime must expose its one-time verification link"
    ).toBeTruthy();

    await page.goto(registration.debugVerificationUrl!);
    await page.getByRole("button", { name: "Confirm email", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Email confirmed", exact: true })
    ).toBeVisible();

    const logout = await rawApi(context, "POST", "/auth/logout");
    expect(logout.status()).toBe(204);
    await page.goto("/en/login");
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password").fill(password);
    const loginResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/auth/login" &&
        response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Login", exact: true }).click();
    const loggedIn = await loginResponse;
    expect(loggedIn.status()).toBe(200);
    const login = (await loggedIn.json()) as { user: Actor["user"] };
    const me = await api<{ user: Actor["user"] }>(context, "GET", "/auth/me");
    expect(me.user).toMatchObject({
      id: registration.user.id,
      email,
      emailVerified: true
    });
    expect(login.user.id).toBe(registration.user.id);
    return { context, email, password, user: me.user };
  } catch (error) {
    await context.close();
    throw error;
  } finally {
    await page.close().catch(() => undefined);
  }
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
  label: string;
  type: string;
  required: boolean;
  options?: string[];
  min?: number;
  max?: number;
};

type CatalogSection = {
  id: string;
  name: string;
  allowedDeliveryTypes: string[];
};

type CatalogGroup = {
  id: string;
  name: string;
  items: Array<{
    id: string;
    name: string;
    sections: CatalogSection[];
  }>;
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

export async function createProductThroughUi(
  seller: Actor,
  label: string
): Promise<ProductFixture> {
  const catalog = await api<{ groups: CatalogGroup[] }>(
    seller.context,
    "GET",
    "/marketplace/catalog"
  );
  const group = catalog.groups.find((candidate) =>
    candidate.items.some((item) =>
      item.sections.some((candidateSection) =>
        candidateSection.allowedDeliveryTypes.includes("manual")
      )
    )
  );
  const item = group?.items.find((candidate) =>
    candidate.sections.some((candidateSection) =>
      candidateSection.allowedDeliveryTypes.includes("manual")
    )
  );
  const section = item?.sections.find((candidate) =>
    candidate.allowedDeliveryTypes.includes("manual")
  );
  expect(group, "the migrated catalog must expose a manual-delivery group").toBeTruthy();
  expect(item, "the migrated catalog must expose a manual-delivery item").toBeTruthy();
  expect(section, "the migrated catalog must expose a manual-delivery section").toBeTruthy();

  const schema = await api<{ schema: { fields: CatalogField[] } }>(
    seller.context,
    "GET",
    `/marketplace/catalog/sections/${section!.id}/schema`
  );
  const page = await seller.context.newPage();
  const title = `E2E ${runId} ${label} ${randomUUID().slice(0, 6)}`;

  try {
    await page.goto("/en/seller/create");
    await page.getByTestId("catalog-group-trigger").click();
    await page.locator(`[data-catalog-group-id="${group!.id}"]`).click();
    await page.locator(`[data-catalog-item-id="${item!.id}"]`).click();
    await page.locator(`[data-catalog-section-id="${section!.id}"]`).click();

    // The golden flow explicitly exercises seller start + deliver. A product with
    // instant delivery jumps directly to `delivered` on payment and would bypass both
    // transitions, so keep this browser-created fixture on manual delivery.
    const autoDelivery = page.getByTestId("auto-delivery-toggle");
    if (section!.allowedDeliveryTypes.includes("instant")) {
      await autoDelivery.uncheck();
    } else {
      await expect(autoDelivery).not.toBeChecked();
    }

    for (const field of schema.schema.fields.filter((candidate) => candidate.required)) {
      const labelText = `${field.label} *`;
      const fieldLabel = page.getByText(labelText, { exact: true });
      await expect(fieldLabel).toBeVisible();
      const container = fieldLabel.locator("..");
      const value = fieldValue(field);
      if (field.type === "select") {
        await container.locator("select").selectOption(String(value));
      } else if (field.type === "multiselect") {
        await container
          .getByRole("button", { name: String((value as string[])[0]), exact: true })
          .click();
      } else if (field.type === "boolean" || field.type === "checkbox") {
        await container.locator('input[type="checkbox"]').check();
      } else if (field.type === "textarea") {
        await container.locator("textarea").fill(String(value));
      } else {
        await container.locator("input").fill(String(value));
      }
    }

    await page.locator('input[maxlength="80"]').fill(title);
    await page
      .locator('textarea[maxlength="500"]')
      .fill(`Browser-created marketplace product for ${runId} and ${label}.`);
    await page.locator('input[type="number"][step="0.01"]').fill("19.99");

    const createResponsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/marketplace/products" &&
        response.request().method() === "POST"
    );
    await page.locator('form button[type="submit"]').click();
    const createResponse = await createResponsePromise;
    expect(createResponse.status()).toBe(201);
    const created = (await createResponse.json()) as { id: string };
    await page.waitForURL((url) =>
      url.pathname.endsWith(`/products/${created.id}`)
    );
    await expect(
      page.getByRole("heading", { name: title, exact: true })
    ).toBeVisible();
    return { id: created.id, title, sectionId: section!.id };
  } finally {
    await page.close();
  }
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
