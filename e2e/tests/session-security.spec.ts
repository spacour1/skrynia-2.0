import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Response
} from "@playwright/test";
import {
  api,
  baseURL,
  closeActors,
  defaultPassword,
  loginActor,
  rawApi,
  registerVerifiedActor,
  runId,
  waitForConnectedWebSocket
} from "./helpers.js";

const AUTH_ME_PATH = "/api/auth/me";
const AUTH_REFRESH_PATH = "/api/auth/refresh";
const AUTH_LOGOUT_PATH = "/api/auth/logout";
const CACHED_USER_KEY = "auth_cached_user";
const PENDING_LOGOUT_KEY = "auth_pending_logout";
const REFRESH_LEASE_KEY_PREFIX = "auth_refresh_lease:";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function isApiResponse(
  response: Response,
  path: string,
  method: string,
  status: number
) {
  return (
    new URL(response.url()).pathname === path &&
    response.request().method() === method &&
    response.status() === status
  );
}

async function installNoWebLocksRefreshProbe(context: BrowserContext) {
  await context.addInitScript((refreshPath) => {
    // The fallback must be exercised even on localhost, which Chromium may treat as a
    // secure context and therefore expose Web Locks on.
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined
    });

    const testWindow = window as typeof window & {
      __e2eRefreshCalls?: number;
    };
    testWindow.__e2eRefreshCalls = 0;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl = input instanceof Request ? input.url : String(input);
      if (new URL(rawUrl, window.location.origin).pathname === refreshPath) {
        testWindow.__e2eRefreshCalls = (testWindow.__e2eRefreshCalls ?? 0) + 1;
      }
      return nativeFetch(input, init);
    };
  }, AUTH_REFRESH_PATH);
}

async function refreshProbeCount(page: Page) {
  return page.evaluate(
    () =>
      (window as typeof window & { __e2eRefreshCalls?: number })
        .__e2eRefreshCalls ?? 0
  );
}

async function activeRefreshLeaseCount(page: Page) {
  return page.evaluate((keyPrefix) => {
    const now = Date.now();
    let count = 0;
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(keyPrefix)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      try {
        const lease = JSON.parse(raw) as Partial<{
          ownerId: string;
          acquiredAt: number;
          expiresAt: number;
          generation: string;
          choosing: boolean;
          holding: boolean;
          ticket: number;
        }>;
        const valid =
          typeof lease.ownerId === "string" && lease.ownerId.length > 0 &&
          typeof lease.generation === "string" && lease.generation.length > 0 &&
          typeof lease.acquiredAt === "number" && Number.isFinite(lease.acquiredAt) &&
          typeof lease.expiresAt === "number" && Number.isFinite(lease.expiresAt) &&
          lease.expiresAt > lease.acquiredAt && lease.expiresAt > now &&
          typeof lease.choosing === "boolean" &&
          typeof lease.holding === "boolean" &&
          typeof lease.ticket === "number" && Number.isSafeInteger(lease.ticket) &&
          lease.ticket >= 0 && (lease.choosing || lease.ticket > 0) &&
          !(lease.choosing && lease.holding);
        if (valid) count += 1;
      } catch {
        // Malformed or partially-written records are not active lease contenders.
      }
    }
    return count;
  }, REFRESH_LEASE_KEY_PREFIX);
}

async function setNavigatorOnline(page: Page, online: boolean) {
  await page.evaluate((value) => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      get: () => value
    });
    window.dispatchEvent(new Event(value ? "online" : "offline"));
  }, online);
}

test("coordinates simultaneous refreshes across tabs when Web Locks are unavailable", async ({
  browser
}) => {
  const actor = await registerVerifiedActor(browser, "refresh-fallback-user");
  await installNoWebLocksRefreshProbe(actor.context);

  const bothInitialRequestsArrived = deferred<void>();
  const releaseFirstRefresh = deferred<void>();
  const firstRefreshSeen = deferred<Page>();

  try {
    const pageA = await actor.context.newPage();
    const pageB = await actor.context.newPage();
    await Promise.all([
      pageA.goto("/en/dashboard"),
      pageB.goto("/en/dashboard")
    ]);
    await Promise.all([
      expect(pageA.getByText(actor.user.displayName, { exact: true }).first()).toBeVisible(),
      expect(pageB.getByText(actor.user.displayName, { exact: true }).first()).toBeVisible()
    ]);
    await expect(pageA.evaluate(() => typeof navigator.locks)).resolves.toBe("undefined");
    await expect(pageB.evaluate(() => typeof navigator.locks)).resolves.toBe("undefined");

    const testPages = new Set([pageA, pageB]);
    const forcedPages = new Set<Page>();
    const authAttempts = new Map<Page, number>();
    let refreshCalls = 0;

    await actor.context.route("**/api/auth/me", async (route, request) => {
      const requestPage = request.frame().page();
      if (!testPages.has(requestPage)) {
        await route.continue();
        return;
      }

      authAttempts.set(requestPage, (authAttempts.get(requestPage) ?? 0) + 1);
      if (!forcedPages.has(requestPage)) {
        forcedPages.add(requestPage);
        if (forcedPages.size === testPages.size) {
          bothInitialRequestsArrived.resolve(undefined);
        }
        await bothInitialRequestsArrived.promise;
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "unauthorized", message: "Expired access session" }
          })
        });
        return;
      }

      await route.continue();
    });

    await actor.context.route("**/api/auth/refresh", async (route, request) => {
      refreshCalls += 1;
      expect(
        refreshCalls,
        "a second tab attempted to redeem the same refresh generation"
      ).toBe(1);
      firstRefreshSeen.resolve(request.frame().page());
      // Keep the first redemption pending until the other tab has published its own
      // valid bakery lease and is demonstrably waiting behind this owner.
      await releaseFirstRefresh.promise;
      await route.continue();
    });

    const initial401A = pageA.waitForResponse((response) =>
      isApiResponse(response, AUTH_ME_PATH, "GET", 401)
    );
    const initial401B = pageB.waitForResponse((response) =>
      isApiResponse(response, AUTH_ME_PATH, "GET", 401)
    );
    const recoveredA = pageA.waitForResponse((response) =>
      isApiResponse(response, AUTH_ME_PATH, "GET", 200)
    );
    const recoveredB = pageB.waitForResponse((response) =>
      isApiResponse(response, AUTH_ME_PATH, "GET", 200)
    );

    const reloads = Promise.all([
      pageA.reload({ waitUntil: "domcontentloaded" }),
      pageB.reload({ waitUntil: "domcontentloaded" })
    ]);
    const [staleA, staleB] = await Promise.all([initial401A, initial401B]);
    await Promise.all([reloads, staleA.finished(), staleB.finished()]);

    const refreshOwner = await firstRefreshSeen.promise;
    const waitingPage = refreshOwner === pageA ? pageB : pageA;
    await expect.poll(
      () => activeRefreshLeaseCount(waitingPage),
      {
        message: "both tabs should publish active leases before the first refresh is released",
        timeout: 5_000,
        intervals: [25, 50, 100, 200]
      }
    ).toBeGreaterThanOrEqual(2);

    const attemptedBeforeRelease =
      (await refreshProbeCount(pageA)) + (await refreshProbeCount(pageB));
    expect(attemptedBeforeRelease).toBe(1);
    expect(refreshCalls).toBe(1);

    releaseFirstRefresh.resolve(undefined);
    const [responseA, responseB] = await Promise.all([recoveredA, recoveredB]);
    const [bodyA, bodyB] = (await Promise.all([
      responseA.json(),
      responseB.json()
    ])) as Array<{ user: { id: string } }>;
    expect(bodyA.user.id).toBe(actor.user.id);
    expect(bodyB.user.id).toBe(actor.user.id);
    expect(refreshCalls).toBe(1);
    expect(authAttempts.get(pageA)).toBe(2);
    expect(authAttempts.get(pageB)).toBe(2);
    await expect.poll(
      () => activeRefreshLeaseCount(waitingPage),
      { timeout: 3_000, intervals: [25, 50, 100, 200] }
    ).toBe(0);

    await Promise.all([
      expect(pageA).toHaveURL(/\/en\/dashboard$/),
      expect(pageB).toHaveURL(/\/en\/dashboard$/),
      expect(pageA.getByText(actor.user.displayName, { exact: true }).first()).toBeVisible(),
      expect(pageB.getByText(actor.user.displayName, { exact: true }).first()).toBeVisible()
    ]);
    const cachedUserIds = await Promise.all(
      [pageA, pageB].map((page) =>
        page.evaluate(() => {
          const raw = window.localStorage.getItem("auth_cached_user");
          return raw ? (JSON.parse(raw) as { id?: string }).id : undefined;
        })
      )
    );
    expect(cachedUserIds).toEqual([actor.user.id, actor.user.id]);
  } finally {
    bothInitialRequestsArrived.resolve(undefined);
    releaseFirstRefresh.resolve(undefined);
    await closeActors(actor);
  }
});

test("a stale tab 401 cannot destroy the generation created by a password change", async ({
  browser
}) => {
  const actor = await registerVerifiedActor(browser, "password-generation-user");
  await installNoWebLocksRefreshProbe(actor.context);
  const oldCredentials = await browser.newContext();
  await oldCredentials.addCookies(await actor.context.cookies(baseURL));
  const staleMeCaptured = deferred<void>();
  const releaseStaleMe = deferred<void>();
  const newPassword = `NewPassword-${runId}!2`;

  try {
    const passwordPage = await actor.context.newPage();
    const stalePage = await actor.context.newPage();
    await Promise.all([
      passwordPage.goto("/en/settings"),
      stalePage.goto("/en/dashboard")
    ]);
    await Promise.all([
      expect(passwordPage.getByText(actor.user.displayName, { exact: true }).first()).toBeVisible(),
      expect(stalePage.getByText(actor.user.displayName, { exact: true }).first()).toBeVisible()
    ]);
    await expect(passwordPage.evaluate(() => typeof navigator.locks)).resolves.toBe("undefined");
    await expect(stalePage.evaluate(() => typeof navigator.locks)).resolves.toBe("undefined");

    let staleMeAttempts = 0;
    let refreshCalls = 0;
    await stalePage.route("**/api/auth/me", async (route) => {
      staleMeAttempts += 1;
      if (staleMeAttempts === 1) {
        staleMeCaptured.resolve(undefined);
        await releaseStaleMe.promise;
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "unauthorized", message: "Stale session response" }
          })
        });
        return;
      }
      await route.continue();
    });
    await actor.context.route("**/api/auth/refresh", async (route) => {
      refreshCalls += 1;
      await route.continue();
    });

    const staleReload = stalePage.reload({ waitUntil: "domcontentloaded" });
    await Promise.all([staleReload, staleMeCaptured.promise]);

    const passwordResponsePromise = passwordPage.waitForResponse((response) =>
      isApiResponse(response, "/api/users/me/password", "POST", 200)
    );
    await passwordPage.getByPlaceholder("Current password").fill(defaultPassword);
    await passwordPage
      .getByPlaceholder("New password", { exact: true })
      .fill(newPassword);
    await passwordPage
      .getByPlaceholder("Repeat new password", { exact: true })
      .fill(newPassword);
    await passwordPage.getByRole("button", { name: "Change password" }).click();
    const passwordResponse = await passwordResponsePromise;
    expect(passwordResponse.headers()["x-session-rotated"]).toBe("true");
    await passwordResponse.finished();
    await expect(
      passwordPage.getByText("Password updated", { exact: true })
    ).toBeVisible();

    const rotationMarkers = await Promise.all(
      [passwordPage, stalePage].map((page) =>
        page.evaluate(() => Number(window.localStorage.getItem("auth_last_refresh_at") ?? 0))
      )
    );
    expect(rotationMarkers[0]).toBeGreaterThan(0);
    expect(rotationMarkers[1]).toBe(rotationMarkers[0]);

    const stale401 = stalePage.waitForResponse((response) =>
      isApiResponse(response, AUTH_ME_PATH, "GET", 401)
    );
    const recovered = stalePage.waitForResponse((response) =>
      isApiResponse(response, AUTH_ME_PATH, "GET", 200)
    );
    releaseStaleMe.resolve(undefined);
    const staleResponse = await stale401;
    await staleResponse.finished();
    const recoveredResponse = await recovered;
    const recoveredBody = (await recoveredResponse.json()) as {
      user: { id: string };
    };
    expect(recoveredBody.user.id).toBe(actor.user.id);
    expect(staleMeAttempts).toBe(2);
    expect(refreshCalls).toBe(0);
    expect(await refreshProbeCount(stalePage)).toBe(0);

    await Promise.all([
      expect(passwordPage).toHaveURL(/\/en\/settings$/),
      expect(stalePage).toHaveURL(/\/en\/dashboard$/),
      expect(stalePage.getByText(actor.user.displayName, { exact: true }).first()).toBeVisible()
    ]);
    const currentSession = await rawApi(actor.context, "GET", "/auth/me");
    expect(currentSession.status()).toBe(200);

    const oldAccess = await rawApi(oldCredentials, "GET", "/auth/me");
    expect(oldAccess.status()).toBe(401);
    const oldRefresh = await rawApi(oldCredentials, "POST", "/auth/refresh");
    expect(oldRefresh.status()).toBe(401);
  } finally {
    releaseStaleMe.resolve(undefined);
    await Promise.all([oldCredentials.close(), closeActors(actor)]);
  }
});

test("password change rotates the current session and revokes HTTP, refresh, and WebSocket access elsewhere", async ({
  browser
}) => {
  const primary = await registerVerifiedActor(browser, "session-user");
  const secondary = await loginActor(browser, primary.email, primary.password);
  const oldCookies = await secondary.context.cookies(baseURL);
  const oldSession = await browser.newContext();
  await oldSession.addCookies(oldCookies);
  const newPassword = `NewPassword-${runId}!1`;

  try {
    const primaryPage = await primary.context.newPage();
    const secondaryPage = await secondary.context.newPage();
    const primarySocketReady = waitForConnectedWebSocket(primaryPage);
    const secondarySocketReady = waitForConnectedWebSocket(secondaryPage);
    await Promise.all([
      primaryPage.goto("/en/settings"),
      secondaryPage.goto("/en/dashboard")
    ]);
    await primarySocketReady;
    const secondarySocket = await secondarySocketReady;
    let secondarySocketClosed = false;
    secondarySocket.on("close", () => {
      secondarySocketClosed = true;
    });

    await primaryPage.getByPlaceholder("Current password").fill(defaultPassword);
    await primaryPage.getByPlaceholder("New password", { exact: true }).fill(newPassword);
    await primaryPage
      .getByPlaceholder("Repeat new password", { exact: true })
      .fill(newPassword);
    await primaryPage.getByRole("button", { name: "Change password" }).click();
    await expect(primaryPage.getByText("Password updated", { exact: true })).toBeVisible();

    const currentSession = await rawApi(primary.context, "GET", "/auth/me");
    expect(currentSession.status()).toBe(200);

    await expect
      .poll(async () => (await rawApi(secondary.context, "GET", "/auth/me")).status())
      .toBe(401);
    await expect.poll(() => secondarySocketClosed).toBe(true);

    const oldRefresh = await rawApi(oldSession, "POST", "/auth/refresh");
    expect(oldRefresh.status()).toBe(401);

    const oldPasswordContext = await browser.newContext();
    const oldPasswordLogin = await rawApi(
      oldPasswordContext,
      "POST",
      "/auth/login",
      { data: { email: primary.email, password: defaultPassword } }
    );
    expect(oldPasswordLogin.status()).toBe(400);
    await oldPasswordContext.close();

    const newPasswordContext = await browser.newContext();
    const newPasswordLogin = await rawApi(
      newPasswordContext,
      "POST",
      "/auth/login",
      { data: { email: primary.email, password: newPassword } }
    );
    expect(newPasswordLogin.status()).toBe(200);
    await newPasswordContext.close();

    const me = await api<{ user: { id: string } }>(
      primary.context,
      "GET",
      "/auth/me"
    );
    expect(me.user.id).toBe(primary.user.id);
  } finally {
    await Promise.all([oldSession.close(), closeActors(primary, secondary)]);
  }
});

test("offline logout stays anonymous across tabs and reload, then retries revocation", async ({
  browser
}) => {
  const actor = await registerVerifiedActor(browser, "offline-logout-user");
  const staleSession = await browser.newContext();
  await staleSession.addCookies(await actor.context.cookies(baseURL));

  let allowLogout = false;
  let logoutAttempts = 0;
  let retryResponse: Response | undefined;
  const firstAbort = deferred<void>();
  const observeResponse = (response: Response) => {
    if (isApiResponse(response, AUTH_LOGOUT_PATH, "POST", 204)) {
      retryResponse = response;
    }
  };

  try {
    const pageA = await actor.context.newPage();
    const pageB = await actor.context.newPage();
    await Promise.all([pageA.goto("/en"), pageB.goto("/en")]);

    const header = (page: Page) => page.locator("header");
    await Promise.all([
      expect(header(pageA).getByText(actor.user.displayName, { exact: true })).toBeVisible(),
      expect(header(pageB).getByText(actor.user.displayName, { exact: true })).toBeVisible()
    ]);

    await pageB.addInitScript(() => {
      Object.defineProperty(window.navigator, "onLine", {
        configurable: true,
        get: () => false
      });
    });
    await actor.context.route("**/api/auth/logout", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      logoutAttempts += 1;
      if (!allowLogout) {
        await route.abort("failed");
        firstAbort.resolve(undefined);
        return;
      }
      await route.continue();
    });
    actor.context.on("response", observeResponse);

    await header(pageA)
      .getByRole("button")
      .filter({ hasText: actor.user.displayName })
      .click();
    await header(pageA)
      .getByRole("button", { name: "Logout", exact: true })
      .click();
    await firstAbort.promise;
    await Promise.all([
      setNavigatorOnline(pageA, false),
      setNavigatorOnline(pageB, false)
    ]);

    await Promise.all([
      expect(header(pageA).getByText("Login", { exact: true })).toBeVisible(),
      expect(header(pageB).getByText("Login", { exact: true })).toBeVisible()
    ]);
    const failedState = await pageB.evaluate(
      ({ cachedKey, pendingKey }) => ({
        cached: window.localStorage.getItem(cachedKey),
        pending: window.localStorage.getItem(pendingKey)
      }),
      { cachedKey: CACHED_USER_KEY, pendingKey: PENDING_LOGOUT_KEY }
    );
    expect(failedState.cached).toBeNull();
    expect(failedState.pending).not.toBeNull();
    expect(JSON.parse(failedState.pending!)).toEqual({
      requestedAt: expect.any(Number),
      attempts: expect.any(Number),
      state: "pending-server-logout"
    });

    await pageB.reload({ waitUntil: "domcontentloaded" });
    await expect(pageB.evaluate(() => navigator.onLine)).resolves.toBe(false);
    await expect(header(pageB).getByText("Login", { exact: true })).toBeVisible();
    const reloadedState = await pageB.evaluate(
      ({ cachedKey, pendingKey }) => ({
        cached: window.localStorage.getItem(cachedKey),
        pending: window.localStorage.getItem(pendingKey)
      }),
      { cachedKey: CACHED_USER_KEY, pendingKey: PENDING_LOGOUT_KEY }
    );
    expect(reloadedState.cached).toBeNull();
    expect(reloadedState.pending).not.toBeNull();

    expect((await rawApi(staleSession, "GET", "/auth/me")).status()).toBe(200);

    allowLogout = true;
    await expect.poll(
      async () => {
        await setNavigatorOnline(pageB, true);
        return retryResponse?.status();
      },
      { timeout: 15_000, intervals: [25, 50, 100, 200] }
    ).toBe(204);

    expect(logoutAttempts).toBeGreaterThanOrEqual(2);
    await expect.poll(() =>
      pageB.evaluate((key) => window.localStorage.getItem(key), PENDING_LOGOUT_KEY)
    ).toBeNull();
    expect(
      await pageB.evaluate((key) => window.localStorage.getItem(key), CACHED_USER_KEY)
    ).toBeNull();
    await expect.poll(
      async () => (await rawApi(staleSession, "GET", "/auth/me")).status()
    ).toBe(401);
    await Promise.all([
      expect(header(pageA).getByText("Login", { exact: true })).toBeVisible(),
      expect(header(pageB).getByText("Login", { exact: true })).toBeVisible()
    ]);
  } finally {
    actor.context.off("response", observeResponse);
    await actor.context.unroute("**/api/auth/logout").catch(() => undefined);
    await Promise.all([staleSession.close(), closeActors(actor)]);
  }
});
