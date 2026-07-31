import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse } from "./helpers/fetch";

const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");

afterEach(() => {
  document.cookie = "csrf_token=; max-age=0; path=/";
  window.localStorage.removeItem("auth_last_refresh_at");
  if (originalLocks) Object.defineProperty(navigator, "locks", originalLocks);
  else Reflect.deleteProperty(navigator, "locks");
});

describe("cross-tab refresh coordination", () => {
  it("serializes independent tabs and redeems a rotated refresh token only once", async () => {
    let lockTail = Promise.resolve();
    const requestLock = vi.fn(async <T>(_name: string, callback: () => Promise<T>) => {
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

    document.cookie = "csrf_token=test-csrf; path=/";
    let resolveRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const resourceCalls = new Map<string, number>();
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
      if (url.pathname === "/api/auth/refresh") {
        refreshCalls += 1;
        return refreshResponse;
      }
      if (url.pathname === "/api/tab-a" || url.pathname === "/api/tab-b") {
        const count = (resourceCalls.get(url.pathname) ?? 0) + 1;
        resourceCalls.set(url.pathname, count);
        return count === 1
          ? jsonResponse({ error: { message: "Expired" } }, { status: 401 })
          : jsonResponse({ tab: url.pathname.endsWith("a") ? "a" : "b" });
      }
      throw new Error(`Unexpected fetch: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const tabA = await import("@/lib/api");
    vi.resetModules();
    const tabB = await import("@/lib/api");

    const requestA = tabA.apiFetch<{ tab: string }>("/tab-a");
    const requestB = tabB.apiFetch<{ tab: string }>("/tab-b");
    await vi.waitFor(() => expect(refreshCalls).toBe(1));
    resolveRefresh(jsonResponse({ ok: true }));

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

  it.each([
    ["Web Locks", true],
    ["the local fallback", false]
  ])("does not let a stale request clear a newly rotated password session with %s", async (_label, supportsWebLocks) => {
    let lockTail = Promise.resolve();
    const requestLock = vi.fn(async <T>(_name: string, callback: () => Promise<T>) => {
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
    Object.defineProperty(navigator, "locks", supportsWebLocks
      ? {
          configurable: true,
          value: { request: requestLock }
        }
      : {
          configurable: true,
          value: undefined
        });

    document.cookie = "csrf_token=old-csrf; path=/";
    let resolvePasswordChange!: (response: Response) => void;
    const passwordResponse = new Promise<Response>((resolve) => {
      resolvePasswordChange = resolve;
    });
    let meCalls = 0;
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
      if (url.pathname === "/api/users/me/password") return passwordResponse;
      if (url.pathname === "/api/auth/me") {
        meCalls += 1;
        return meCalls === 1
          ? jsonResponse({ error: { message: "Stale session" } }, { status: 401 })
          : jsonResponse({ user: { id: "current-user" } });
      }
      if (url.pathname === "/api/auth/refresh") {
        refreshCalls += 1;
        return jsonResponse({ error: { message: "Old refresh" } }, { status: 401 });
      }
      throw new Error(`Unexpected fetch: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { apiFetch } = await import("@/lib/api");
    const passwordChange = apiFetch<{ ok: boolean }>("/users/me/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: "old", newPassword: "new" })
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const staleMe = apiFetch<{ user: { id: string } }>("/auth/me");
    await vi.waitFor(() => expect(meCalls).toBe(1));

    resolvePasswordChange(jsonResponse(
      { ok: true },
      { headers: { "X-Session-Rotated": "true" } }
    ));

    await expect(passwordChange).resolves.toEqual({ ok: true });
    await expect(staleMe).resolves.toEqual({ user: { id: "current-user" } });
    expect(refreshCalls).toBe(0);
    expect(meCalls).toBe(2);
    expect(requestLock).toHaveBeenCalledTimes(supportsWebLocks ? 2 : 0);
  });
});
