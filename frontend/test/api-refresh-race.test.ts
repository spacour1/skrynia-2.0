import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse } from "./helpers/fetch";
import { TestBroadcastChannel } from "./setup";

const AUTH_SYNC_CHANNEL = "auth-session-sync";
const RECENT_REFRESH_KEY = "auth_last_refresh_at";
const RECENT_REFRESH_GENERATION_KEY = "auth_last_refresh_generation";
const REFRESH_LEASE_KEY_PREFIX = "auth_refresh_lease:";

type RefreshLease = {
  ownerId: string;
  acquiredAt: number;
  expiresAt: number;
  generation: string;
  choosing: boolean;
  holding: boolean;
  ticket: number;
};

const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function requestPath(input: RequestInfo | URL) {
  return new URL(input instanceof Request ? input.url : String(input), window.location.origin).pathname;
}

function disableWebLocks() {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: undefined
  });
}

function installSerializedWebLocks() {
  let lockTail = Promise.resolve();
  const requestLock = vi.fn(async <T>(
    _name: string,
    _options: LockOptions,
    callback: () => Promise<T>
  ) => {
    const previous = lockTail;
    let release!: () => void;
    lockTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await callback();
    } finally {
      release();
    }
  });
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request: requestLock }
  });
  return requestLock;
}

async function importIndependentApiClients() {
  vi.resetModules();
  const tabA = await import("@/lib/api");
  vi.resetModules();
  const tabB = await import("@/lib/api");
  return { tabA, tabB };
}

function setCsrfCookie() {
  document.cookie = "csrf_token=test-csrf; path=/";
}

function activeForeignLease(overrides: Partial<RefreshLease> = {}): RefreshLease {
  const now = Date.now();
  return {
    ownerId: "foreign-tab",
    acquiredAt: now,
    expiresAt: now + 30_000,
    generation: "foreign-generation",
    choosing: false,
    holding: true,
    ticket: 1,
    ...overrides
  };
}

function refreshLeaseKey(ownerId: string) {
  return `${REFRESH_LEASE_KEY_PREFIX}${encodeURIComponent(ownerId)}`;
}

function writeForeignLease(lease: RefreshLease) {
  window.localStorage.setItem(refreshLeaseKey(lease.ownerId), JSON.stringify(lease));
}

function refreshLeaseEntries(): Array<{ key: string; lease: RefreshLease }> {
  const entries: Array<{ key: string; lease: RefreshLease }> = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(REFRESH_LEASE_KEY_PREFIX)) continue;
    const raw = window.localStorage.getItem(key);
    if (raw) entries.push({ key, lease: JSON.parse(raw) as RefreshLease });
  }
  return entries;
}

function clearRefreshLeaseEntries() {
  for (const { key } of refreshLeaseEntries()) {
    window.localStorage.removeItem(key);
  }
}

afterEach(() => {
  document.cookie = "csrf_token=; max-age=0; path=/";
  try {
    window.localStorage.removeItem(RECENT_REFRESH_KEY);
    window.localStorage.removeItem(RECENT_REFRESH_GENERATION_KEY);
    clearRefreshLeaseEntries();
  } catch {
    // A storage-restriction test intentionally replaces these methods with throwers.
  }
  window.history.replaceState({}, "", "/");
  if (originalLocks) Object.defineProperty(navigator, "locks", originalLocks);
  else Reflect.deleteProperty(navigator, "locks");
});

describe("cross-tab refresh coordination", () => {
  it("serializes independent tabs with Web Locks and redeems the refresh token only once", async () => {
    const requestLock = installSerializedWebLocks();
    setCsrfCookie();
    const refreshGate = deferred<Response>();
    const resourceCalls = new Map<string, number>();
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/auth/refresh") {
        refreshCalls += 1;
        return refreshGate.promise;
      }
      if (path === "/api/tab-a" || path === "/api/tab-b") {
        const count = (resourceCalls.get(path) ?? 0) + 1;
        resourceCalls.set(path, count);
        return count === 1
          ? jsonResponse({ error: { message: "Expired" } }, { status: 401 })
          : jsonResponse({ tab: path.endsWith("a") ? "a" : "b" });
      }
      throw new Error(`Unexpected fetch: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { tabA, tabB } = await importIndependentApiClients();

    const requestA = tabA.apiFetch<{ tab: string }>("/tab-a");
    const requestB = tabB.apiFetch<{ tab: string }>("/tab-b");
    await vi.waitFor(() => expect(refreshCalls).toBe(1));
    refreshGate.resolve(jsonResponse({ ok: true }));

    await expect(Promise.all([requestA, requestB])).resolves.toEqual([
      { tab: "a" },
      { tab: "b" }
    ]);
    expect(refreshCalls).toBe(1);
    expect(resourceCalls).toEqual(new Map([
      ["/api/tab-a", 2],
      ["/api/tab-b", 2]
    ]));
    expect(requestLock).toHaveBeenCalledTimes(2);
  });

  it("serializes independent tabs with the localStorage lease when Web Locks are unavailable", async () => {
    disableWebLocks();
    setCsrfCookie();
    const refreshGate = deferred<Response>();
    const resourceCalls = new Map<string, number>();
    let claimsAtFirstRefresh: Array<{ key: string; lease: RefreshLease }> = [];
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/auth/refresh") {
        refreshCalls += 1;
        if (refreshCalls === 1) claimsAtFirstRefresh = refreshLeaseEntries();
        return refreshGate.promise;
      }
      if (path === "/api/tab-a" || path === "/api/tab-b") {
        const count = (resourceCalls.get(path) ?? 0) + 1;
        resourceCalls.set(path, count);
        return count === 1
          ? jsonResponse({ error: { message: "Expired" } }, { status: 401 })
          : jsonResponse({ tab: path.endsWith("a") ? "a" : "b" });
      }
      throw new Error(`Unexpected fetch: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { tabA, tabB } = await importIndependentApiClients();

    const requestA = tabA.apiFetch<{ tab: string }>("/tab-a");
    const requestB = tabB.apiFetch<{ tab: string }>("/tab-b");
    await vi.waitFor(() => expect(refreshCalls).toBe(1));
    expect(claimsAtFirstRefresh).toHaveLength(2);
    expect(new Set(claimsAtFirstRefresh.map(({ key }) => key)).size).toBe(2);
    expect(new Set(claimsAtFirstRefresh.map(({ lease }) => lease.ownerId)).size).toBe(2);
    expect(claimsAtFirstRefresh.map(({ lease }) => lease.ticket).sort((a, b) => a - b))
      .toEqual([1, 2]);
    expect(claimsAtFirstRefresh.every(({ lease }) => !lease.choosing)).toBe(true);
    expect(claimsAtFirstRefresh.filter(({ lease }) => lease.holding)).toHaveLength(1);
    refreshGate.resolve(jsonResponse({ ok: true }));

    await expect(Promise.all([requestA, requestB])).resolves.toEqual([
      { tab: "a" },
      { tab: "b" }
    ]);
    expect(refreshCalls).toBe(1);
    expect(resourceCalls).toEqual(new Map([
      ["/api/tab-a", 2],
      ["/api/tab-b", 2]
    ]));
    expect(refreshLeaseEntries()).toEqual([]);
  });

  it("keeps an active holder authoritative across a wall-clock jump beyond the TTL", async () => {
    disableWebLocks();
    vi.useFakeTimers({
      toFake: ["Date", "performance", "setTimeout", "clearTimeout"]
    });
    vi.setSystemTime(new Date("2026-08-10T00:00:00.000Z"));
    const releaseHolder = deferred<Response>();
    let rotationCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path !== "/api/auth/login") throw new Error(`Unexpected fetch: ${path}`);
      rotationCalls += 1;
      return rotationCalls === 1 ? releaseHolder.promise : jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { tabA, tabB } = await importIndependentApiClients();

    const holderRequest = tabA.apiFetch<{ ok: boolean }>("/auth/login", { method: "POST" });
    await vi.advanceTimersByTimeAsync(500);
    expect(rotationCalls).toBe(1);
    expect(refreshLeaseEntries().filter(({ lease }) => lease.holding)).toHaveLength(1);
    const monotonicBeforeJump = performance.now();

    vi.setSystemTime(new Date(Date.now() + 60_000));
    expect(performance.now()).toBe(monotonicBeforeJump);
    const contenderRequest = tabB.apiFetch<{ ok: boolean }>("/auth/login", { method: "POST" });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(rotationCalls).toBe(1);
    expect(refreshLeaseEntries()).toHaveLength(2);
    expect(refreshLeaseEntries().filter(({ lease }) => lease.holding)).toHaveLength(1);

    releaseHolder.resolve(jsonResponse({ ok: true }));
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(Promise.all([holderRequest, contenderRequest])).resolves.toEqual([
      { ok: true },
      { ok: true }
    ]);
    expect(rotationCalls).toBe(2);
    expect(refreshLeaseEntries()).toEqual([]);
  });

  it("serializes concurrent rotations with the in-page lock when localStorage is restricted", async () => {
    disableWebLocks();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage is disabled", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is disabled", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Storage is disabled", "SecurityError");
    });
    const releaseFirstRotation = deferred<void>();
    let activeRotations = 0;
    let maximumOverlap = 0;
    let rotationCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path !== "/api/auth/login" && path !== "/api/auth/register") {
        throw new Error(`Unexpected fetch: ${path}`);
      }
      rotationCalls += 1;
      activeRotations += 1;
      maximumOverlap = Math.max(maximumOverlap, activeRotations);
      if (rotationCalls === 1) await releaseFirstRotation.promise;
      activeRotations -= 1;
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { apiFetch } = await import("@/lib/api");

    const login = apiFetch<{ ok: boolean }>("/auth/login", { method: "POST" });
    const register = apiFetch<{ ok: boolean }>("/auth/register", { method: "POST" });
    await vi.waitFor(() => expect(rotationCalls).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rotationCalls).toBe(1);
    expect(maximumOverlap).toBe(1);

    releaseFirstRotation.resolve(undefined);
    await expect(Promise.all([login, register])).resolves.toEqual([
      { ok: true },
      { ok: true }
    ]);
    expect(rotationCalls).toBe(2);
    expect(maximumOverlap).toBe(1);
  });

  it("fails closed when storage enumeration breaks after publishing its own claim", async () => {
    disableWebLocks();
    const foreignLease = activeForeignLease();
    writeForeignLease(foreignLease);
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const lengthSpy = vi.spyOn(Storage.prototype, "length", "get")
      .mockImplementation(() => {
        throw new DOMException("Storage enumeration failed", "SecurityError");
      });
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { apiFetch } = await import("@/lib/api");

    await expect(apiFetch("/auth/login", { method: "POST" })).rejects.toMatchObject({
      name: "RefreshCoordinationTimeoutError",
      message: "Timed out waiting for cross-tab session coordination"
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setItemSpy).toHaveBeenCalledOnce();
    expect(setItemSpy.mock.calls[0]?.[0]).toMatch(/^auth_refresh_lease:/);
    expect(setItemSpy.mock.calls[0]?.[0]).not.toBe(refreshLeaseKey(foreignLease.ownerId));

    lengthSpy.mockRestore();
    expect(refreshLeaseEntries()).toEqual([{
      key: refreshLeaseKey(foreignLease.ownerId),
      lease: foreignLease
    }]);
  });

  it("ignores a stale foreign claim and releases only its own generation", async () => {
    disableWebLocks();
    const now = Date.now();
    const staleLease = activeForeignLease({
      acquiredAt: now - 20_000,
      expiresAt: now - 1_000,
      generation: "stale-generation"
    });
    writeForeignLease(staleLease);
    const responseGate = deferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/auth/login") return responseGate.promise;
      throw new Error(`Unexpected fetch: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { apiFetch } = await import("@/lib/api");

    const request = apiFetch<{ ok: boolean }>("/auth/login", { method: "POST" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const heldLease = refreshLeaseEntries()
      .map(({ lease }) => lease)
      .find((lease) => lease.ownerId !== staleLease.ownerId);
    expect(heldLease).toMatchObject({
      ownerId: expect.any(String),
      acquiredAt: expect.any(Number),
      expiresAt: expect.any(Number),
      generation: expect.any(String),
      choosing: false,
      holding: true,
      ticket: 1
    });
    expect(heldLease?.ownerId).not.toBe("foreign-tab");
    expect(heldLease?.generation).not.toBe("stale-generation");
    expect(heldLease?.expiresAt).toBeGreaterThan(Date.now());

    responseGate.resolve(jsonResponse({ ok: true }, { headers: { "X-Session-Rotated": "true" } }));
    await expect(request).resolves.toEqual({ ok: true });
    expect(refreshLeaseEntries()).toEqual([{
      key: refreshLeaseKey(staleLease.ownerId),
      lease: staleLease
    }]);
  });

  it("waits for an active lease and wakes on the release notification", async () => {
    disableWebLocks();
    const foreignLease = activeForeignLease();
    writeForeignLease(foreignLease);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/auth/login") return jsonResponse({ ok: true });
      throw new Error(`Unexpected fetch: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { apiFetch } = await import("@/lib/api");

    const request = apiFetch<{ ok: boolean }>("/auth/login", { method: "POST" });
    await vi.waitFor(() => {
      expect(TestBroadcastChannel.peerCount(AUTH_SYNC_CHANNEL)).toBeGreaterThanOrEqual(1);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(refreshLeaseEntries()).toHaveLength(2);
    });

    window.localStorage.removeItem(refreshLeaseKey(foreignLease.ownerId));
    TestBroadcastChannel.broadcast(AUTH_SYNC_CHANNEL, {
      type: "refresh-lock-released",
      generation: foreignLease.generation
    });

    await expect(request).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(refreshLeaseEntries()).toEqual([]);
  });

  it("yields to an active holder even when that holder has a later bakery ticket", async () => {
    disableWebLocks();
    vi.useFakeTimers({
      toFake: ["Date", "performance", "setTimeout", "clearTimeout"]
    });
    vi.setSystemTime(new Date("2026-08-10T00:00:00.000Z"));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/auth/login") return jsonResponse({ ok: true });
      throw new Error(`Unexpected fetch: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { apiFetch } = await import("@/lib/api");

    const request = apiFetch<{ ok: boolean }>("/auth/login", { method: "POST" });
    await vi.advanceTimersByTimeAsync(0);
    const waitingLease = refreshLeaseEntries()[0]?.lease;
    expect(waitingLease).toMatchObject({ choosing: false, holding: false, ticket: 1 });

    const laterHolder = activeForeignLease({
      ownerId: "zz-later-holder",
      generation: "later-holder-generation",
      ticket: 99,
      holding: true
    });
    writeForeignLease(laterHolder);
    await vi.advanceTimersByTimeAsync(500);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(refreshLeaseEntries()).toHaveLength(2);

    window.localStorage.removeItem(refreshLeaseKey(laterHolder.ownerId));
    TestBroadcastChannel.broadcast(AUTH_SYNC_CHANNEL, {
      type: "refresh-lock-released",
      generation: laterHolder.generation
    });
    await vi.advanceTimersByTimeAsync(500);

    await expect(request).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(refreshLeaseEntries()).toEqual([]);
  });

  it("does not remove a lease that another tab acquired before release", async () => {
    disableWebLocks();
    const responseGate = deferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/auth/login") return responseGate.promise;
      throw new Error(`Unexpected fetch: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { apiFetch } = await import("@/lib/api");

    const request = apiFetch<{ ok: boolean }>("/auth/login", { method: "POST" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const ownedLease = refreshLeaseEntries()[0]?.lease;
    expect(ownedLease?.generation).toEqual(expect.any(String));

    const foreignLease = activeForeignLease({ generation: "replacement-generation" });
    writeForeignLease(foreignLease);
    responseGate.resolve(jsonResponse({ ok: true }));

    await expect(request).resolves.toEqual({ ok: true });
    expect(refreshLeaseEntries()).toEqual([{
      key: refreshLeaseKey(foreignLease.ownerId),
      lease: foreignLease
    }]);
  });

  it("renews the owned claim while an operation runs beyond the 30 second TTL", async () => {
    disableWebLocks();
    vi.useFakeTimers({
      toFake: ["Date", "performance", "setTimeout", "clearTimeout"]
    });
    vi.setSystemTime(new Date("2026-08-10T00:00:00.000Z"));
    const responseGate = deferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/auth/login") return responseGate.promise;
      throw new Error(`Unexpected fetch: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { apiFetch } = await import("@/lib/api");

    const request = apiFetch<{ ok: boolean }>("/auth/login", { method: "POST" });
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledOnce();
    const initialLease = refreshLeaseEntries()[0]?.lease;
    expect(initialLease).toMatchObject({
      generation: expect.any(String),
      choosing: false,
      holding: true,
      ticket: 1
    });
    const initialExpiry = initialLease!.expiresAt;

    await vi.advanceTimersByTimeAsync(31_000);
    const renewedLease = refreshLeaseEntries()[0]?.lease;
    expect(renewedLease?.generation).toBe(initialLease?.generation);
    expect(renewedLease?.expiresAt).toBeGreaterThan(initialExpiry);
    const coordinationNow = performance.timeOrigin + performance.now();
    expect(renewedLease?.expiresAt).toBeGreaterThan(coordinationNow);

    responseGate.resolve(jsonResponse({ ok: true }));
    await expect(request).resolves.toEqual({ ok: true });
    expect(refreshLeaseEntries()).toEqual([]);
  });

  it("aborts when the owned claim cannot be verified and fences it until expiry", async () => {
    disableWebLocks();
    vi.useFakeTimers({
      toFake: ["Date", "performance", "setTimeout", "clearTimeout"]
    });
    vi.setSystemTime(new Date("2026-08-10T00:00:00.000Z"));
    let operationSignal: AbortSignal | null | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(input);
      if (path !== "/api/auth/login") {
        return Promise.reject(new Error(`Unexpected fetch: ${path}`));
      }
      const signal = init?.signal;
      operationSignal = signal;
      return new Promise<Response>((_resolve, reject) => {
        if (!signal) {
          reject(new Error("Missing coordination signal"));
          return;
        }
        const rejectOnAbort = () => reject(signal.reason);
        if (signal.aborted) rejectOnAbort();
        else signal.addEventListener("abort", rejectOnAbort, { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { apiFetch } = await import("@/lib/api");

    const request = apiFetch<{ ok: boolean }>("/auth/login", { method: "POST" });
    const requestFailure = request.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledOnce();
    const ownedEntry = refreshLeaseEntries()[0];
    expect(ownedEntry?.lease.generation).toEqual(expect.any(String));

    const getItemSpy = vi.spyOn(Storage.prototype, "getItem")
      .mockImplementationOnce(() => {
        throw new DOMException("Storage lookup failed", "SecurityError");
      });
    await vi.advanceTimersByTimeAsync(5_100);

    await expect(requestFailure).resolves.toMatchObject({
      name: "RefreshCoordinationUnavailableError",
      message: "Cross-tab session coordination is unavailable"
    });
    expect(getItemSpy).toHaveBeenCalled();
    expect(operationSignal?.aborted).toBe(true);
    expect(refreshLeaseEntries()).toEqual([ownedEntry]);

    await vi.advanceTimersByTimeAsync(30_100);
    expect(refreshLeaseEntries()).toEqual([]);
  });

  it("aborts a protected rotation after the 60 second operation limit", async () => {
    disableWebLocks();
    vi.useFakeTimers({
      toFake: ["Date", "performance", "setTimeout", "clearTimeout"]
    });
    vi.setSystemTime(new Date("2026-08-10T00:00:00.000Z"));
    let operationSignal: AbortSignal | null | undefined;
    let rotationCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(input);
      if (path !== "/api/auth/login") {
        return Promise.reject(new Error(`Unexpected fetch: ${path}`));
      }
      rotationCalls += 1;
      if (rotationCalls > 1) return Promise.resolve(jsonResponse({ ok: true }));
      const signal = init?.signal;
      operationSignal = signal;
      return new Promise<Response>((_resolve, reject) => {
        if (!signal) {
          reject(new Error("Missing coordination signal"));
          return;
        }
        const rejectOnAbort = () => reject(signal.reason);
        if (signal.aborted) rejectOnAbort();
        else signal.addEventListener("abort", rejectOnAbort, { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { apiFetch } = await import("@/lib/api");

    const request = apiFetch<{ ok: boolean }>("/auth/login", { method: "POST" });
    const requestFailure = request.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(refreshLeaseEntries()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(60_100);

    await expect(requestFailure).resolves.toMatchObject({
      name: "RefreshCoordinationTimeoutError",
      message: "Timed out waiting for cross-tab session coordination"
    });
    expect(operationSignal?.aborted).toBe(true);
    expect(refreshLeaseEntries()).toHaveLength(1);
    expect(refreshLeaseEntries()[0]?.lease).toMatchObject({ holding: true });

    await expect(apiFetch("/auth/login", { method: "POST" })).rejects.toMatchObject({
      name: "RefreshCoordinationTimeoutError",
      message: "Timed out waiting for cross-tab session coordination"
    });
    expect(rotationCalls).toBe(1);

    await vi.advanceTimersByTimeAsync(30_100);
    expect(refreshLeaseEntries()).toEqual([]);

    const recoveredRequest = apiFetch<{ ok: boolean }>("/auth/login", { method: "POST" });
    await vi.advanceTimersByTimeAsync(500);
    await expect(recoveredRequest).resolves.toEqual({ ok: true });
    expect(rotationCalls).toBe(2);
    expect(refreshLeaseEntries()).toEqual([]);
  });

  it("times out a blocked bakery claim within the bounded acquisition window", async () => {
    disableWebLocks();
    vi.useFakeTimers({
      toFake: ["Date", "performance", "setTimeout", "clearTimeout"]
    });
    vi.setSystemTime(new Date("2026-08-10T00:00:00.000Z"));
    const foreignLease = activeForeignLease({ expiresAt: Date.now() + 60_000 });
    writeForeignLease(foreignLease);
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { apiFetch } = await import("@/lib/api");

    const request = apiFetch<{ ok: boolean }>("/auth/login", { method: "POST" });
    const requestFailure = request.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(15_100);

    await expect(requestFailure).resolves.toMatchObject({
      name: "RefreshCoordinationTimeoutError",
      message: "Timed out waiting for cross-tab session coordination"
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refreshLeaseEntries()).toEqual([{
      key: refreshLeaseKey(foreignLease.ownerId),
      lease: foreignLease
    }]);
  });

  it("releases its bakery claim in finally when the protected rotation throws", async () => {
    disableWebLocks();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/auth/login") throw new TypeError("rotation transport failed");
      throw new Error(`Unexpected fetch: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { apiFetch } = await import("@/lib/api");

    await expect(apiFetch("/auth/login", { method: "POST" }))
      .rejects.toThrow("rotation transport failed");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(refreshLeaseEntries()).toEqual([]);
  });

  it("skips redemption only when another tab refreshes after the original request starts", async () => {
    disableWebLocks();
    setCsrfCookie();
    window.localStorage.setItem(RECENT_REFRESH_KEY, String(Date.now()));
    window.localStorage.setItem(RECENT_REFRESH_GENERATION_KEY, "baseline-generation");
    const initialResponse = deferred<Response>();
    let resourceCalls = 0;
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/auth/refresh") {
        refreshCalls += 1;
        return jsonResponse({ ok: true });
      }
      if (path === "/api/protected") {
        resourceCalls += 1;
        return resourceCalls === 1 ? initialResponse.promise : jsonResponse({ ok: true });
      }
      throw new Error(`Unexpected fetch: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { apiFetch } = await import("@/lib/api");

    const request = apiFetch<{ ok: boolean }>("/protected");
    await vi.waitFor(() => expect(resourceCalls).toBe(1));
    expect(window.localStorage.getItem(RECENT_REFRESH_GENERATION_KEY))
      .toBe("baseline-generation");
    window.localStorage.setItem(RECENT_REFRESH_KEY, String(Date.now()));
    window.localStorage.setItem(RECENT_REFRESH_GENERATION_KEY, "other-tab-generation");
    initialResponse.resolve(jsonResponse(
      { error: { message: "Expired" } },
      { status: 401 }
    ));

    await expect(request).resolves.toEqual({ ok: true });
    expect(resourceCalls).toBe(2);
    expect(refreshCalls).toBe(0);
    expect(window.localStorage.getItem(RECENT_REFRESH_GENERATION_KEY))
      .toBe("other-tab-generation");
    expect(refreshLeaseEntries()).toEqual([]);
  });

  it.each([
    "/users/me/2fa/enable",
    "/users/me/2fa/disable",
    "/users/me/2fa/backup-codes/regenerate"
  ])("coordinates the session-rotating endpoint %s", async (path) => {
    const requestLock = installSerializedWebLocks();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const actualPath = requestPath(input);
      if (actualPath === `/api${path}`) {
        return jsonResponse({ ok: true }, { headers: { "X-Session-Rotated": "true" } });
      }
      throw new Error(`Unexpected fetch: ${actualPath}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { apiFetch } = await import("@/lib/api");

    await expect(apiFetch<{ ok: boolean }>(path, { method: "POST" })).resolves.toEqual({ ok: true });
    expect(requestLock).toHaveBeenCalledOnce();
  });

  it("does not classify password reset as issuing a new session generation", async () => {
    const requestLock = installSerializedWebLocks();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/auth/password/reset") return jsonResponse({ status: "reset" });
      throw new Error(`Unexpected fetch: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { apiFetch } = await import("@/lib/api");

    await expect(apiFetch<{ status: string }>("/auth/password/reset", { method: "POST" }))
      .resolves.toEqual({ status: "reset" });
    expect(requestLock).not.toHaveBeenCalled();
  });

  it("does not redeem refresh when Web Locks rejects before its callback starts", async () => {
    const requestLock = vi.fn(async () => {
      throw new DOMException("Web Locks unavailable", "NotSupportedError");
    });
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request: requestLock }
    });
    setCsrfCookie();
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/protected") {
        return jsonResponse({ error: { message: "Expired access" } }, { status: 401 });
      }
      if (path === "/api/auth/refresh") {
        refreshCalls += 1;
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unexpected fetch: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { apiFetch } = await import("@/lib/api");

    await expect(apiFetch("/protected")).rejects.toMatchObject({ status: 401 });
    expect(requestLock).toHaveBeenCalledOnce();
    expect(refreshCalls).toBe(0);
    expect(refreshLeaseEntries()).toEqual([]);
  });

  it("bounds the Web Locks wait and never starts a callback after its signal aborts", async () => {
    vi.useFakeTimers({
      toFake: ["Date", "performance", "setTimeout", "clearTimeout"]
    });
    vi.setSystemTime(new Date("2026-08-10T00:00:00.000Z"));
    setCsrfCookie();
    let lockSignal: AbortSignal | undefined;
    let lockCallback: (() => Promise<unknown>) | undefined;
    const requestLock = vi.fn((
      _name: string,
      options: LockOptions,
      callback: () => Promise<unknown>
    ) => {
      lockSignal = options.signal;
      lockCallback = callback;
      return new Promise<unknown>((_resolve, reject) => {
        const signal = options.signal;
        if (!signal) {
          reject(new Error("Missing Web Locks wait signal"));
          return;
        }
        const rejectOnAbort = () => reject(signal.reason);
        if (signal.aborted) rejectOnAbort();
        else signal.addEventListener("abort", rejectOnAbort, { once: true });
      });
    });
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request: requestLock }
    });
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/protected") {
        return jsonResponse({ error: { message: "Expired access" } }, { status: 401 });
      }
      if (path === "/api/auth/refresh") {
        refreshCalls += 1;
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unexpected fetch: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { apiFetch } = await import("@/lib/api");

    const request = apiFetch("/protected");
    const requestFailure = request.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(15_100);

    await expect(requestFailure).resolves.toMatchObject({ status: 401 });
    expect(requestLock).toHaveBeenCalledOnce();
    expect(lockSignal?.aborted).toBe(true);
    expect(lockSignal?.reason).toMatchObject({ name: "RefreshCoordinationTimeoutError" });
    expect(lockCallback).toEqual(expect.any(Function));
    expect(refreshCalls).toBe(0);
    expect(refreshLeaseEntries()).toEqual([]);
  });

  it("bounds every local queue waiter without releasing later waiters through the predecessor", async () => {
    disableWebLocks();
    vi.useFakeTimers({
      toFake: ["Date", "performance", "setTimeout", "clearTimeout"]
    });
    vi.setSystemTime(new Date("2026-08-10T00:00:00.000Z"));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is disabled", "SecurityError");
    });
    const firstGate = deferred<Response>();
    let rotationCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (!["/api/auth/login", "/api/auth/register", "/api/auth/telegram"].includes(path)) {
        throw new Error(`Unexpected fetch: ${path}`);
      }
      rotationCalls += 1;
      return rotationCalls === 1 ? firstGate.promise : jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { apiFetch } = await import("@/lib/api");

    const first = apiFetch<{ ok: boolean }>("/auth/login", { method: "POST" });
    await vi.advanceTimersByTimeAsync(0);
    expect(rotationCalls).toBe(1);

    const second = apiFetch("/auth/register", { method: "POST" });
    const secondFailure = second.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(15_100);
    await expect(secondFailure).resolves.toMatchObject({
      name: "RefreshCoordinationTimeoutError"
    });
    expect(rotationCalls).toBe(1);

    const third = apiFetch("/auth/telegram", { method: "POST" });
    const thirdFailure = third.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(15_100);
    await expect(thirdFailure).resolves.toMatchObject({
      name: "RefreshCoordinationTimeoutError"
    });
    expect(rotationCalls).toBe(1);

    firstGate.resolve(jsonResponse({ ok: true }));
    await vi.advanceTimersByTimeAsync(0);
    await expect(first).resolves.toEqual({ ok: true });

    const recovered = apiFetch<{ ok: boolean }>("/auth/login", { method: "POST" });
    await vi.advanceTimersByTimeAsync(0);
    await expect(recovered).resolves.toEqual({ ok: true });
    expect(rotationCalls).toBe(2);
  });

  it("uses one cross-tab boundary for password rotation and a stale request", async () => {
    disableWebLocks();
    setCsrfCookie();
    window.history.replaceState({}, "", "/en/login");
    const passwordGate = deferred<Response>();
    let meCalls = 0;
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/users/me/password") return passwordGate.promise;
      if (path === "/api/auth/me") {
        meCalls += 1;
        return meCalls === 1
          ? jsonResponse({ error: { message: "Stale session" } }, { status: 401 })
          : jsonResponse({ user: { id: "current-user" } });
      }
      if (path === "/api/auth/refresh") {
        refreshCalls += 1;
        return jsonResponse({ error: { message: "Old refresh" } }, { status: 401 });
      }
      throw new Error(`Unexpected fetch: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { tabA, tabB } = await importIndependentApiClients();

    const passwordChange = tabA.apiFetch<{ ok: boolean }>("/users/me/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: "old", newPassword: "new" })
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const staleMe = tabB.apiFetch<{ user: { id: string } }>("/auth/me");
    await vi.waitFor(() => expect(meCalls).toBe(1));

    passwordGate.resolve(jsonResponse(
      { ok: true },
      { headers: { "X-Session-Rotated": "true" } }
    ));

    await expect(passwordChange).resolves.toEqual({ ok: true });
    await expect(staleMe).resolves.toEqual({ user: { id: "current-user" } });
    expect(refreshCalls).toBe(0);
    expect(meCalls).toBe(2);
  });

  it.each([401, 403])("classifies a rejected refresh with status %s as invalid", async (status) => {
    disableWebLocks();
    setCsrfCookie();
    window.history.replaceState({}, "", "/en/login");
    const sessionEnded = vi.fn();
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/protected") {
        return jsonResponse({ error: { message: "Expired access" } }, { status: 401 });
      }
      if (path === "/api/auth/refresh") {
        refreshCalls += 1;
        return jsonResponse({ error: { message: "Rejected refresh" } }, { status });
      }
      throw new Error(`Unexpected fetch: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { tabA, tabB } = await importIndependentApiClients();
    const unsubscribe = tabB.onSessionEnded(sessionEnded);

    await expect(tabA.apiFetch("/protected")).rejects.toMatchObject({ status: 401 });
    expect(refreshCalls).toBe(1);
    expect(sessionEnded).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it.each([
    ["rate limit", 429],
    ["server failure", 500],
    ["network failure", "network"]
  ] as const)("classifies a refresh %s as retry-later", async (_label, refreshFailure) => {
    disableWebLocks();
    setCsrfCookie();
    const sessionEnded = vi.fn();
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/protected") {
        return jsonResponse({ error: { message: "Expired access" } }, { status: 401 });
      }
      if (path === "/api/auth/refresh") {
        refreshCalls += 1;
        if (refreshFailure === "network") throw new TypeError("offline");
        return jsonResponse({ error: { message: "Temporary refresh failure" } }, { status: refreshFailure });
      }
      throw new Error(`Unexpected fetch: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { tabA, tabB } = await importIndependentApiClients();
    const unsubscribe = tabB.onSessionEnded(sessionEnded);

    await expect(tabA.apiFetch("/protected")).rejects.toMatchObject({ status: 401 });
    expect(refreshCalls).toBe(1);
    expect(sessionEnded).not.toHaveBeenCalled();
    unsubscribe();
  });
});
