import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/lib/api";
import { readCachedUser, useAuth } from "@/lib/auth-store";
import { installFetchMock, jsonResponse } from "./helpers/fetch";

const apiMock = vi.hoisted(() => ({
  sessionEndedHandler: undefined as (() => void) | undefined
}));

vi.mock("@sentry/nextjs", () => ({ setUser: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    broadcastSessionEnded: vi.fn(),
    onSessionEnded: vi.fn((handler: () => void) => {
      apiMock.sessionEndedHandler = handler;
      return () => undefined;
    })
  };
});

const cachedUser: User = {
  id: "user-cached",
  email: "cached@example.com",
  displayName: "Cached User",
  role: "user"
};

const recoveredUser: User = {
  ...cachedUser,
  displayName: "Recovered User"
};

function resetAuthState() {
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
  ])("preserves the cached user in degraded mode after %s", async (_name, response) => {
    cacheUserWithoutHydratingState();
    const requests = installFetchMock([{ path: "/api/auth/me", response }]);

    await expect(useAuth.getState().hydrate()).resolves.toBe("degraded");

    expect(useAuth.getState()).toMatchObject({
      user: cachedUser,
      status: "degraded",
      hydrated: true
    });
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
});
