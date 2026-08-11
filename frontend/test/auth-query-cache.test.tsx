import { useQuery } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthScopedQueryClientProvider } from "@/app/[locale]/providers";
import { useAuth } from "@/lib/auth-store";

function setAuthIdentity(userId: string | null) {
  useAuth.setState({
    user: userId ? {
      id: userId,
      email: `${userId}@example.test`,
      displayName: userId,
      role: "user",
      avatarUrl: null,
      pushEnabled: false,
      twoFactorEnabled: false,
      createdAt: "2026-08-11T00:00:00.000Z",
      online: null,
      emailVerified: true,
      phone: null,
      phoneVerified: false,
      telegramConnected: false
    } : null,
    status: userId ? "authenticated" : "anonymous",
    hydrated: true
  });
}

describe("auth-scoped React Query cache", () => {
  beforeEach(() => {
    useAuth.setState({ user: null, status: "unknown", hydrated: false });
  });

  function AccountOrders() {
    const userId = useAuth((state) => state.user?.id ?? null);
    const orders = useQuery({
      queryKey: ["orders"],
      queryFn: async () => ({ owner: userId }),
      enabled: userId !== null,
      staleTime: Infinity
    });
    return <output>{orders.data?.owner ?? "no-account-data"}</output>;
  }

  it("remounts active query observers on logout before another account signs in", async () => {
    setAuthIdentity("user-a");
    render(
      <AuthScopedQueryClientProvider>
        <AccountOrders />
      </AuthScopedQueryClientProvider>
    );
    expect(await screen.findByText("user-a")).toBeInTheDocument();

    act(() => setAuthIdentity(null));
    expect(await screen.findByText("no-account-data")).toBeInTheDocument();
    expect(screen.queryByText("user-a")).not.toBeInTheDocument();

    act(() => setAuthIdentity("user-b"));
    expect(await screen.findByText("user-b")).toBeInTheDocument();
    expect(screen.queryByText("user-a")).not.toBeInTheDocument();
  });

  it("remounts active query observers when an authenticated identity changes directly", async () => {
    setAuthIdentity("user-a");
    render(
      <AuthScopedQueryClientProvider>
        <AccountOrders />
      </AuthScopedQueryClientProvider>
    );
    expect(await screen.findByText("user-a")).toBeInTheDocument();

    act(() => setAuthIdentity("user-b"));

    expect(await screen.findByText("user-b")).toBeInTheDocument();
    expect(screen.queryByText("user-a")).not.toBeInTheDocument();
  });

  it("keeps public query observers on a normal first-load guest hydration", async () => {
    const publicQuery = vi.fn(async () => "public-catalog");
    function PublicCatalog() {
      const catalog = useQuery({
        queryKey: ["public-catalog"],
        queryFn: publicQuery,
        staleTime: Infinity
      });
      return <output>{catalog.data ?? "loading"}</output>;
    }
    render(
      <AuthScopedQueryClientProvider>
        <PublicCatalog />
      </AuthScopedQueryClientProvider>
    );
    expect(await screen.findByText("public-catalog")).toBeInTheDocument();

    act(() => setAuthIdentity(null));

    expect(screen.getByText("public-catalog")).toBeInTheDocument();
    expect(publicQuery).toHaveBeenCalledOnce();
  });
});
