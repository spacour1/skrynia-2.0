import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, getLastSessionEstablishedAt, type User } from "@/lib/api";
import {
  LOGOUT_REQUEST_TIMEOUT_MS,
  PENDING_LOGOUT_STORAGE_KEY,
  PENDING_LOGOUT_TTL_MS,
  hasPendingLogout,
  readCachedUser,
  retryPendingLogout,
  startPendingLogoutRecovery,
  useAuth
} from "@/lib/auth-store";
import { installFetchMock, jsonResponse } from "./helpers/fetch";

const apiMock = vi.hoisted(() => ({
  broadcastSessionEnded: vi.fn(),
  requestServerLogout: vi.fn(),
  sessionEstablishedHandler: undefined as ((
    establishedAt: number,
    source: "local" | "peer"
  ) => void) | undefined,
  sessionEndedHandler: undefined as ((message?: {
    logoutRequestedAt?: number;
    sessionEndedAt?: number;
  }) => void) | undefined
}));

const SESSION_ESTABLISHED_AT_KEY = "auth_session_established_at";

vi.mock("@sentry/nextjs", () => ({ setUser: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    broadcastSessionEnded: (logoutRequestedAt?: number, sessionEndedAt?: number) => {
      apiMock.broadcastSessionEnded(logoutRequestedAt, sessionEndedAt);
      actual.broadcastSessionEnded(logoutRequestedAt, sessionEndedAt);
    },
    requestServerLogout: apiMock.requestServerLogout,
    onSessionEstablished: vi.fn((handler: (
      establishedAt: number,
      source: "local" | "peer"
    ) => void) => {
      apiMock.sessionEstablishedHandler = handler;
      return actual.onSessionEstablished(handler);
    }),
    onSessionEnded: vi.fn((handler: (message?: {
      logoutRequestedAt?: number;
      sessionEndedAt?: number;
    }) => void) => {
      apiMock.sessionEndedHandler = handler;
      return actual.onSessionEnded(handler);
    })
  };
});

const cachedUser: User = {
  id: "user-cached",
  email: "cached@example.com",
  displayName: "Cached User",
  role: "user",
  avatarUrl: null,
  pushEnabled: false,
  twoFactorEnabled: false,
  createdAt: "2026-07-31T12:00:00.000Z",
  online: null,
  emailVerified: true,
  phone: null,
  phoneVerified: false,
  telegramConnected: false
};

const recoveredUser: User = {
  ...cachedUser,
  displayName: "Recovered User"
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function pendingLogoutMarker(requestedAt = Date.now(), attempts = 0) {
  return {
    requestedAt,
    attempts,
    state: "pending-server-logout"
  };
}

function resetAuthState() {
  apiMock.broadcastSessionEnded.mockReset();
  apiMock.requestServerLogout.mockReset();
  apiMock.requestServerLogout.mockResolvedValue("logout-confirmed");
  useAuth.setState({ user: null, status: "unknown", hydrated: false });
  document.cookie = "csrf_token=; max-age=0; path=/";
}

function cacheUserWithoutHydratingState() {
  useAuth.getState().setAuthenticated(cachedUser);
  useAuth.setState({ user: null, status: "unknown", hydrated: false });
}

describe("auth hydration reliability", () => {
  beforeEach(resetAuthState);

  it.each([401, 403])("treats a definitive %s response as anonymous and clears cache", async (status) => {
    useAuth.getState().setAuthenticated(cachedUser);
    const requests = installFetchMock([
      {
        path: "/api/auth/me",
        response: jsonResponse({ error: { message: "Session rejected" } }, { status })
      }
    ]);

    await expect(useAuth.getState().hydrate()).resolves.toBe("anonymous");

    expect(useAuth.getState()).toMatchObject({
      user: null,
      status: "anonymous",
      hydrated: true
    });
    expect(readCachedUser()).toBeNull();
    requests.assertAllUsed();
  });

  it.each([
    ["network failure", () => { throw new TypeError("offline"); }],
    ["rate limit", () => jsonResponse({ error: { message: "Slow down" } }, { status: 429 })],
    ["server failure", () => jsonResponse({ error: { message: "Unavailable" } }, { status: 500 })],
    ["invalid response", () => jsonResponse({ user: { id: "incomplete" } })]
  ])("does not restore a cold-start cached user after %s", async (_name, response) => {
    cacheUserWithoutHydratingState();
    const requests = installFetchMock([{ path: "/api/auth/me", response }]);

    await expect(useAuth.getState().hydrate()).resolves.toBe("degraded");

    expect(useAuth.getState()).toMatchObject({
      user: null,
      status: "degraded",
      hydrated: true
    });
    // The non-sensitive cache may remain for a later confirmed recovery, but it is not
    // allowed to drive UI/private queries on its own.
    expect(readCachedUser()).toEqual(cachedUser);
    requests.assertAllUsed();
  });

  it("recovers from degraded to authenticated and refreshes the cached profile", async () => {
    useAuth.getState().setAuthenticated(cachedUser);
    const requests = installFetchMock([
      {
        path: "/api/auth/me",
        response: jsonResponse({ error: { message: "Unavailable" } }, { status: 500 })
      },
      {
        path: "/api/auth/me",
        response: jsonResponse({ user: recoveredUser })
      }
    ]);

    await expect(useAuth.getState().hydrate()).resolves.toBe("degraded");
    expect(useAuth.getState().user).toEqual(cachedUser);

    await expect(useAuth.getState().hydrate()).resolves.toBe("authenticated");
    expect(useAuth.getState()).toMatchObject({
      user: recoveredUser,
      status: "authenticated",
      hydrated: true
    });
    expect(readCachedUser()).toEqual(recoveredUser);
    requests.assertAllUsed();
  });

  it("preserves definitive cross-tab logout by clearing state and cache", () => {
    useAuth.getState().setAuthenticated(cachedUser);

    apiMock.sessionEndedHandler?.();

    expect(useAuth.getState()).toMatchObject({
      user: null,
      status: "anonymous",
      hydrated: true
    });
    expect(readCachedUser()).toBeNull();
  });

  it("persists a peer logout marker from BroadcastChannel for later recovery", () => {
    useAuth.getState().setAuthenticated(cachedUser);
    const requestedAt = Date.now() + 1;

    apiMock.sessionEndedHandler?.({ logoutRequestedAt: requestedAt });

    expect(useAuth.getState()).toMatchObject({ user: null, status: "anonymous" });
    expect(JSON.parse(
      window.localStorage.getItem(PENDING_LOGOUT_STORAGE_KEY) ?? "null"
    )).toEqual({
      requestedAt,
      attempts: 1,
      state: "pending-server-logout"
    });
  });

  it("does not let a delayed hydrate restore a definitively logged-out session", async () => {
    useAuth.getState().setAuthenticated(cachedUser);
    let resolveHydrate!: (response: Response) => void;
    const requests = installFetchMock([
      {
        path: "/api/auth/me",
        response: () => new Promise((resolve) => {
          resolveHydrate = resolve;
        })
      }
    ]);

    const hydration = useAuth.getState().hydrate();
    await vi.waitFor(() => expect(requests.fetchMock).toHaveBeenCalledOnce());
    apiMock.sessionEndedHandler?.();
    resolveHydrate(jsonResponse({ user: recoveredUser }));

    await expect(hydration).resolves.toBe("anonymous");
    expect(useAuth.getState()).toMatchObject({
      user: null,
      status: "anonymous",
      hydrated: true
    });
    expect(readCachedUser()).toBeNull();
    requests.assertAllUsed();
  });

  it("clears state and broadcasts logout even when the logout request fails", async () => {
    useAuth.getState().setAuthenticated(cachedUser);
    apiMock.requestServerLogout.mockRejectedValueOnce(new TypeError("offline"));

    await expect(useAuth.getState().logout()).resolves.toBeUndefined();

    expect(useAuth.getState()).toMatchObject({
      user: null,
      status: "anonymous",
      hydrated: true
    });
    expect(readCachedUser()).toBeNull();
    expect(apiMock.broadcastSessionEnded).toHaveBeenCalledOnce();
    expect(hasPendingLogout()).toBe(true);
  });

  it("keeps a same-millisecond logout newer than the session it ends", async () => {
    const fixedNow = Math.max(Date.now(), Math.ceil(getLastSessionEstablishedAt())) + 1_000;
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    useAuth.getState().establishSession(cachedUser);
    apiMock.requestServerLogout.mockResolvedValueOnce("retry-later");

    await useAuth.getState().logout();

    expect(useAuth.getState()).toMatchObject({ user: null, status: "anonymous" });
    expect(hasPendingLogout()).toBe(true);
    expect(apiMock.requestServerLogout).toHaveBeenCalledOnce();
  });

  it("becomes anonymous before the server request settles and clears the marker after 204", async () => {
    useAuth.getState().setAuthenticated(cachedUser);
    const server = deferred<"logout-confirmed">();
    apiMock.requestServerLogout.mockReturnValueOnce(server.promise);

    const logout = useAuth.getState().logout();

    expect(useAuth.getState()).toMatchObject({
      user: null,
      status: "anonymous",
      hydrated: true
    });
    expect(readCachedUser()).toBeNull();
    expect(apiMock.broadcastSessionEnded).toHaveBeenCalledOnce();
    expect(apiMock.broadcastSessionEnded.mock.calls[0]?.[0]).toEqual(expect.any(Number));
    const marker = JSON.parse(
      window.localStorage.getItem(PENDING_LOGOUT_STORAGE_KEY) ?? "null"
    );
    expect(marker).toEqual({
      requestedAt: expect.any(Number),
      attempts: 1,
      state: "pending-server-logout"
    });
    expect(Object.keys(marker).sort()).toEqual(["attempts", "requestedAt", "state"]);

    server.resolve("logout-confirmed");
    await expect(logout).resolves.toBeUndefined();
    expect(hasPendingLogout()).toBe(false);
  });

  it("blocks cached-user restore and /auth/me while a failed logout marker survives reload", async () => {
    window.localStorage.setItem("auth_cached_user", JSON.stringify(cachedUser));
    window.localStorage.setItem(
      PENDING_LOGOUT_STORAGE_KEY,
      JSON.stringify(pendingLogoutMarker())
    );
    apiMock.requestServerLogout.mockResolvedValueOnce("retry-later");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(readCachedUser()).toBeNull();
    await expect(useAuth.getState().hydrate()).resolves.toBe("anonymous");

    expect(useAuth.getState()).toMatchObject({ user: null, status: "anonymous" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hasPendingLogout()).toBe(true);
  });

  it("deduplicates online retries and clears the marker after recovery", async () => {
    const stopRecovery = startPendingLogoutRecovery();
    apiMock.requestServerLogout.mockResolvedValueOnce("retry-later");
    await useAuth.getState().logout();
    expect(apiMock.requestServerLogout).toHaveBeenCalledTimes(1);

    const retry = deferred<"logout-confirmed">();
    apiMock.requestServerLogout.mockReturnValueOnce(retry.promise);
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(apiMock.requestServerLogout).toHaveBeenCalledTimes(2));

    retry.resolve("logout-confirmed");
    await vi.waitFor(() => expect(hasPendingLogout()).toBe(false));
    stopRecovery();
  });

  it("queues one online recovery when connectivity returns during an active attempt", async () => {
    const stopRecovery = startPendingLogoutRecovery();
    const firstAttempt = deferred<"retry-later">();
    apiMock.requestServerLogout
      .mockReturnValueOnce(firstAttempt.promise)
      .mockResolvedValueOnce("logout-confirmed");

    const logout = useAuth.getState().logout();
    await vi.waitFor(() => expect(apiMock.requestServerLogout).toHaveBeenCalledOnce());
    window.dispatchEvent(new Event("online"));
    firstAttempt.resolve("retry-later");

    await logout;
    await vi.waitFor(() => expect(apiMock.requestServerLogout).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(hasPendingLogout()).toBe(false));
    stopRecovery();
  });

  it("does not retry a peer attempts-counter storage update as a new logout", async () => {
    const stopRecovery = startPendingLogoutRecovery();
    const requestedAt = Math.max(Date.now(), getLastSessionEstablishedAt()) + 1;
    const oldMarker = pendingLogoutMarker(requestedAt, 0);
    const nextMarker = pendingLogoutMarker(requestedAt, 1);
    window.localStorage.setItem(PENDING_LOGOUT_STORAGE_KEY, JSON.stringify(oldMarker));
    const attempt = deferred<"retry-later">();
    apiMock.requestServerLogout.mockReturnValueOnce(attempt.promise);

    const retry = retryPendingLogout();
    await vi.waitFor(() => expect(apiMock.requestServerLogout).toHaveBeenCalledOnce());
    window.dispatchEvent(new StorageEvent("storage", {
      key: PENDING_LOGOUT_STORAGE_KEY,
      oldValue: JSON.stringify(oldMarker),
      newValue: JSON.stringify(nextMarker)
    }));
    attempt.resolve("retry-later");
    await retry;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(apiMock.requestServerLogout).toHaveBeenCalledOnce();
    expect(hasPendingLogout()).toBe(true);
    stopRecovery();
  });

  it("expires a bounded marker, removes stale cache and resumes authoritative hydration", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-10T00:00:00.000Z"));
    window.localStorage.setItem("auth_cached_user", JSON.stringify(cachedUser));
    window.localStorage.setItem(
      PENDING_LOGOUT_STORAGE_KEY,
      JSON.stringify(pendingLogoutMarker(Date.now() - PENDING_LOGOUT_TTL_MS - 1, 4))
    );
    const requests = installFetchMock([{
      path: "/api/auth/me",
      response: jsonResponse({ error: { message: "No session" } }, { status: 401 })
    }]);

    expect(hasPendingLogout()).toBe(false);
    expect(readCachedUser()).toBeNull();
    await expect(useAuth.getState().hydrate()).resolves.toBe("anonymous");
    requests.assertAllUsed();
  });

  it("does not let a same-tab delayed hydrate restore the user after logout", async () => {
    useAuth.getState().setAuthenticated(cachedUser);
    const hydrateResponse = deferred<Response>();
    const logoutResponse = deferred<"logout-confirmed">();
    const requests = installFetchMock([{
      path: "/api/auth/me",
      response: () => hydrateResponse.promise
    }]);
    apiMock.requestServerLogout.mockReturnValueOnce(logoutResponse.promise);

    const hydration = useAuth.getState().hydrate();
    await vi.waitFor(() => expect(requests.fetchMock).toHaveBeenCalledOnce());
    const logout = useAuth.getState().logout();
    hydrateResponse.resolve(jsonResponse({ user: recoveredUser }));

    await expect(hydration).resolves.toBe("anonymous");
    expect(useAuth.getState()).toMatchObject({ user: null, status: "anonymous" });
    logoutResponse.resolve("logout-confirmed");
    await logout;
    requests.assertAllUsed();
  });

  it.each([
    ["server 401 / unconfirmed", "retry-later", true],
    ["rejected refresh / terminal anonymous", "anonymous-unconfirmed", false],
    ["server 503 / retry later", "retry-later", true]
  ] as const)("handles %s without claiming an unconfirmed revocation", async (_name, outcome, remainsPending) => {
    apiMock.requestServerLogout.mockResolvedValueOnce(outcome);

    await useAuth.getState().logout();

    expect(useAuth.getState().status).toBe("anonymous");
    expect(hasPendingLogout()).toBe(remainsPending);
  });

  it("aborts a hung logout request after the bounded timeout and stays pending", async () => {
    vi.useFakeTimers();
    apiMock.requestServerLogout.mockImplementationOnce(
      ({ signal }: { signal?: AbortSignal }) => new Promise<"retry-later">((resolve) => {
        signal?.addEventListener("abort", () => resolve("retry-later"), { once: true });
      })
    );

    const logout = useAuth.getState().logout();
    expect(useAuth.getState().status).toBe("anonymous");
    await vi.advanceTimersByTimeAsync(LOGOUT_REQUEST_TIMEOUT_MS);
    await expect(logout).resolves.toBeUndefined();
    expect(hasPendingLogout()).toBe(true);
  });

  it("rejects a stale profile update but lets a deliberate new login cancel pending logout", async () => {
    apiMock.requestServerLogout.mockResolvedValueOnce("retry-later");
    await useAuth.getState().logout();
    expect(hasPendingLogout()).toBe(true);

    useAuth.getState().setUser(recoveredUser);
    expect(hasPendingLogout()).toBe(true);
    expect(useAuth.getState()).toMatchObject({ user: null, status: "anonymous" });

    useAuth.getState().establishSession(recoveredUser);

    expect(hasPendingLogout()).toBe(false);
    expect(useAuth.getState()).toMatchObject({
      user: recoveredUser,
      status: "authenticated"
    });
    expect(hasPendingLogout()).toBe(false);
  });

  it("rejects a delayed profile response from the account that logged out", () => {
    useAuth.getState().setAuthenticated(cachedUser);
    const nextAccount = { ...recoveredUser, id: "user-next", email: "next@example.com" };
    useAuth.getState().establishSession(nextAccount);

    useAuth.getState().setUser({ ...cachedUser, displayName: "Late profile A" });

    expect(useAuth.getState()).toMatchObject({
      user: nextAccount,
      status: "authenticated"
    });
  });

  it("drops the old account and hydrates the peer-established cookie session", async () => {
    useAuth.getState().setAuthenticated(cachedUser);
    const nextAccount = { ...recoveredUser, id: "user-peer", email: "peer@example.com" };
    const requests = installFetchMock([{
      path: "/api/auth/me",
      response: jsonResponse({ user: nextAccount })
    }]);
    const establishedAt = Math.max(Date.now(), getLastSessionEstablishedAt()) + 1;

    apiMock.sessionEstablishedHandler?.(establishedAt, "peer");

    expect(useAuth.getState()).toMatchObject({ user: null, status: "anonymous" });
    await vi.waitFor(() => expect(useAuth.getState()).toMatchObject({
      user: nextAccount,
      status: "authenticated"
    }));
    requests.assertAllUsed();
  });

  it("cancels the marker inside the login cookie lock before apiFetch returns", async () => {
    apiMock.requestServerLogout.mockResolvedValueOnce("retry-later");
    await useAuth.getState().logout();
    expect(hasPendingLogout()).toBe(true);
    const requests = installFetchMock([{
      method: "POST",
      path: "/api/auth/login",
      response: jsonResponse(
        { user: recoveredUser },
        { headers: { "X-Session-Rotated": "true" } }
      )
    }]);

    await apiFetch("/auth/login", { method: "POST" });

    expect(hasPendingLogout()).toBe(false);
    requests.assertAllUsed();
  });

  it("ignores a delayed old logout event only after a deliberate newer login", () => {
    const requestedAt = Date.now() - 1;
    useAuth.getState().establishSession(recoveredUser);

    apiMock.sessionEndedHandler?.({ logoutRequestedAt: requestedAt });

    expect(useAuth.getState()).toMatchObject({
      user: recoveredUser,
      status: "authenticated"
    });
  });

  it("ignores a delayed logout in a third tab after another tab established a newer session", () => {
    const requestedAt = Date.now() + 10;
    useAuth.setState({ user: recoveredUser, status: "authenticated", hydrated: true });
    window.localStorage.setItem(SESSION_ESTABLISHED_AT_KEY, String(requestedAt + 1));

    apiMock.sessionEndedHandler?.({ logoutRequestedAt: requestedAt });

    expect(useAuth.getState()).toMatchObject({
      user: recoveredUser,
      status: "authenticated"
    });
    expect(hasPendingLogout()).toBe(false);
  });

  it("applies a peer logout tied with the last observed login generation", async () => {
    useAuth.getState().setAuthenticated(cachedUser);
    const tiedAt = Math.max(Date.now(), getLastSessionEstablishedAt()) + 1;
    window.localStorage.setItem(SESSION_ESTABLISHED_AT_KEY, String(tiedAt));
    apiMock.requestServerLogout.mockResolvedValueOnce("retry-later");

    apiMock.sessionEndedHandler?.({ logoutRequestedAt: tiedAt });

    await vi.waitFor(() => expect(apiMock.requestServerLogout).toHaveBeenCalledOnce());
    expect(useAuth.getState()).toMatchObject({ user: null, status: "anonymous" });
    expect(hasPendingLogout()).toBe(true);
    useAuth.getState().setAuthenticated(cachedUser);
  });

  it("ignores a delayed terminal session event after a newer deliberate login", () => {
    const endedAt = Math.max(Date.now(), getLastSessionEstablishedAt()) + 1;
    window.localStorage.setItem(SESSION_ESTABLISHED_AT_KEY, String(endedAt + 1));
    useAuth.setState({ user: recoveredUser, status: "authenticated", hydrated: true });

    apiMock.sessionEndedHandler?.({ sessionEndedAt: endedAt });

    expect(useAuth.getState()).toMatchObject({
      user: recoveredUser,
      status: "authenticated"
    });
    expect(hasPendingLogout()).toBe(false);
    expect(apiMock.requestServerLogout).not.toHaveBeenCalled();
  });

  it("applies a terminal session event without creating a pending logout claim", () => {
    useAuth.getState().setAuthenticated(cachedUser);
    const endedAt = Math.max(Date.now(), getLastSessionEstablishedAt()) + 1;

    apiMock.sessionEndedHandler?.({ sessionEndedAt: endedAt });

    expect(useAuth.getState()).toMatchObject({ user: null, status: "anonymous" });
    expect(hasPendingLogout()).toBe(false);
    expect(apiMock.requestServerLogout).not.toHaveBeenCalled();
  });

  it("retries a peer storage marker immediately and clears it after server confirmation", async () => {
    useAuth.getState().setAuthenticated(cachedUser);
    const stopRecovery = startPendingLogoutRecovery();
    const requestedAt = Math.max(Date.now(), getLastSessionEstablishedAt()) + 1;
    const marker = pendingLogoutMarker(requestedAt);
    window.localStorage.setItem(PENDING_LOGOUT_STORAGE_KEY, JSON.stringify(marker));

    window.dispatchEvent(new StorageEvent("storage", {
      key: PENDING_LOGOUT_STORAGE_KEY,
      newValue: JSON.stringify(marker)
    }));

    await vi.waitFor(() => expect(apiMock.requestServerLogout).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(hasPendingLogout()).toBe(false));
    expect(useAuth.getState()).toMatchObject({ user: null, status: "anonymous" });
    stopRecovery();
  });

  it("discards a persisted logout marker superseded by a newer shared login", () => {
    const requestedAt = Math.max(Date.now(), getLastSessionEstablishedAt()) + 10;
    window.localStorage.setItem(
      PENDING_LOGOUT_STORAGE_KEY,
      JSON.stringify(pendingLogoutMarker(requestedAt))
    );
    window.localStorage.setItem(SESSION_ESTABLISHED_AT_KEY, String(requestedAt + 1));

    expect(hasPendingLogout()).toBe(false);
    expect(window.localStorage.getItem(PENDING_LOGOUT_STORAGE_KEY)).toBeNull();
  });

  it("ignores a corrupt future login timestamp when creating a real logout marker", async () => {
    useAuth.setState({ user: cachedUser, status: "authenticated", hydrated: true });
    window.localStorage.setItem(SESSION_ESTABLISHED_AT_KEY, String(Number.MAX_SAFE_INTEGER));
    apiMock.requestServerLogout.mockResolvedValueOnce("retry-later");

    await useAuth.getState().logout();

    const marker = JSON.parse(
      window.localStorage.getItem(PENDING_LOGOUT_STORAGE_KEY) ?? "null"
    ) as { requestedAt: number } | null;
    expect(marker?.requestedAt).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(hasPendingLogout()).toBe(true);
  });

  it("applies a delayed logout event after ordinary hydration even if its marker was cleared", async () => {
    const requestedAt = Math.max(Date.now(), getLastSessionEstablishedAt()) + 1;
    const requests = installFetchMock([{
      path: "/api/auth/me",
      response: jsonResponse({ user: recoveredUser })
    }]);
    await expect(useAuth.getState().hydrate()).resolves.toBe("authenticated");

    apiMock.sessionEndedHandler?.({ logoutRequestedAt: requestedAt });

    expect(useAuth.getState()).toMatchObject({ user: null, status: "anonymous" });
    requests.assertAllUsed();
  });

  it("still clears in-memory auth when localStorage writes fail", async () => {
    useAuth.setState({ user: cachedUser, status: "authenticated", hydrated: true });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage disabled", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Storage disabled", "SecurityError");
    });
    apiMock.requestServerLogout.mockResolvedValueOnce("retry-later");

    await expect(useAuth.getState().logout()).resolves.toBeUndefined();

    expect(useAuth.getState()).toMatchObject({ user: null, status: "anonymous" });
    expect(hasPendingLogout()).toBe(true);
    useAuth.getState().setAuthenticated(cachedUser);
  });

  it("keeps a memory logout marker when a peer login is not newer", async () => {
    useAuth.setState({ user: cachedUser, status: "authenticated", hydrated: true });
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage disabled", "SecurityError");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage disabled", "SecurityError");
    });
    const removeItem = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Storage disabled", "SecurityError");
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    apiMock.requestServerLogout.mockResolvedValueOnce("retry-later");

    try {
      await useAuth.getState().logout();
      const requestedAt = apiMock.broadcastSessionEnded.mock.calls[0]?.[0] as number;

      // Use the real API observation path: it records the equal generation before
      // invoking auth-store, exactly like a peer BroadcastChannel/storage delivery.
      window.dispatchEvent(new StorageEvent("storage", {
        key: SESSION_ESTABLISHED_AT_KEY,
        newValue: String(requestedAt)
      }));

      expect(useAuth.getState()).toMatchObject({ user: null, status: "anonymous" });
      expect(hasPendingLogout()).toBe(true);
      expect(apiMock.requestServerLogout).toHaveBeenCalledOnce();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
      removeItem.mockRestore();
      // Do not leak the deliberate memory-only marker into the next isolated case.
      useAuth.getState().setAuthenticated(cachedUser);
    }
  });

  it("migrates a memory logout marker after the localStorage getter recovers", async () => {
    useAuth.setState({ user: cachedUser, status: "authenticated", hydrated: true });
    apiMock.requestServerLogout.mockResolvedValueOnce("retry-later");
    const storageGetter = vi.spyOn(window, "localStorage", "get")
      .mockImplementationOnce(() => {
        throw new DOMException("Storage disabled", "SecurityError");
      });

    try {
      await expect(useAuth.getState().logout()).resolves.toBeUndefined();
    } finally {
      storageGetter.mockRestore();
    }

    expect(useAuth.getState()).toMatchObject({ user: null, status: "anonymous" });
    expect(hasPendingLogout()).toBe(true);
    expect(JSON.parse(
      window.localStorage.getItem(PENDING_LOGOUT_STORAGE_KEY) ?? "null"
    )).toMatchObject({ state: "pending-server-logout" });
  });
});
