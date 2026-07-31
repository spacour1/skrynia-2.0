import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse } from "./helpers/fetch";

const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");

afterEach(() => {
  document.cookie = "csrf_token=; max-age=0; path=/";
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
});
