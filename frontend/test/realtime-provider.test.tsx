import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthStatus } from "@/lib/auth-store";
import { useAuth } from "@/lib/auth-store";
import { RealtimeProvider } from "@/components/RealtimeProvider";
import { CurrencyProvider, useCurrency } from "@/lib/currency";
import { renderWithProviders } from "./helpers/render";

type FakeRealtimeInstance = {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  refreshAuthentication: ReturnType<typeof vi.fn>;
  triggerTerminalAuthenticationFailure: () => void;
};

const realtimeMock = vi.hoisted(() => ({
  instances: [] as FakeRealtimeInstance[]
}));

vi.mock("@sentry/nextjs", () => ({ setUser: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiFetch: vi.fn(async () => ({
      baseCurrency: "UAH",
      rates: [
        { code: "UAH", rateToUah: "1", source: "test", asOf: "2026-01-01", updatedAt: "2026-01-01" },
        { code: "USD", rateToUah: "40", source: "test", asOf: "2026-01-01", updatedAt: "2026-01-01" },
        { code: "EUR", rateToUah: "45", source: "test", asOf: "2026-01-01", updatedAt: "2026-01-01" }
      ]
    })),
    broadcastSessionEnded: vi.fn(),
    onAuthenticationRefreshed: vi.fn(() => () => undefined),
    onSessionEnded: vi.fn(() => () => undefined)
  };
});

vi.mock("@/lib/realtime-client", () => {
  class FakeRealtimeClient {
    private snapshot = {
      status: "stopped",
      reconnectAttempt: 0,
      error: null as Error | null
    };

    start = vi.fn(() => {
      this.snapshot = { status: "connected", reconnectAttempt: 0, error: null };
    });

    stop = vi.fn(() => {
      this.snapshot = { status: "stopped", reconnectAttempt: 0, error: null };
    });

    refreshAuthentication = vi.fn(() => {
      this.snapshot = { status: "connecting", reconnectAttempt: 0, error: null };
    });

    setVisible = vi.fn();
    setOnline = vi.fn();
    subscribeState = vi.fn(() => () => undefined);
    getSnapshot = () => this.snapshot;

    constructor(private readonly options: { onTerminalAuthenticationFailure?: () => void } = {}) {
      realtimeMock.instances.push(this as unknown as FakeRealtimeInstance);
    }

    triggerTerminalAuthenticationFailure() {
      this.snapshot = {
        status: "stopped",
        reconnectAttempt: 0,
        error: new Error("Session rejected")
      };
      this.options.onTerminalAuthenticationFailure?.();
    }
  }

  return { RealtimeClient: FakeRealtimeClient };
});

const user = {
  id: "realtime-user",
  email: "realtime@example.com",
  displayName: "Realtime User",
  role: "user" as const,
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

function currentClient() {
  const client = realtimeMock.instances.at(-1);
  if (!client) throw new Error("Expected RealtimeProvider to create a client");
  return client;
}

describe("RealtimeProvider auth lifecycle", () => {
  beforeEach(() => {
    realtimeMock.instances.length = 0;
    useAuth.setState({ user: null, status: "unknown", hydrated: false });
  });

  it("keeps the existing client running across authenticated to degraded", () => {
    useAuth.getState().setAuthenticated(user);
    renderWithProviders(
      <RealtimeProvider>
        <span>realtime child</span>
      </RealtimeProvider>
    );
    const client = currentClient();

    expect(screen.getByText("realtime child")).toBeInTheDocument();
    expect(client.start).toHaveBeenCalledOnce();
    expect(client.stop).not.toHaveBeenCalled();

    act(() => useAuth.getState().setDegraded());
    expect(client.stop).not.toHaveBeenCalled();

    act(() => useAuth.getState().setAnonymous());
    expect(client.stop).toHaveBeenCalledOnce();
  });

  it("keeps the same realtime client when the display currency changes", async () => {
    const userInteraction = userEvent.setup();
    useAuth.getState().setAuthenticated(user);

    function CurrencyProbe() {
      const { displayCurrency, setDisplayCurrency } = useCurrency();
      return (
        <button type="button" onClick={() => setDisplayCurrency("USD")}>
          {displayCurrency}
        </button>
      );
    }

    renderWithProviders(
      <CurrencyProvider>
        <RealtimeProvider>
          <CurrencyProbe />
        </RealtimeProvider>
      </CurrencyProvider>
    );
    const client = currentClient();

    await userInteraction.click(screen.getByRole("button", { name: "UAH" }));

    expect(await screen.findByRole("button", { name: "USD" })).toBeInTheDocument();
    expect(realtimeMock.instances).toHaveLength(1);
    expect(currentClient()).toBe(client);
    expect(client.start).toHaveBeenCalledOnce();
    expect(client.stop).not.toHaveBeenCalled();
  });

  it("revalidates a terminal auth rejection once and performs at most one recovery reconnect", async () => {
    useAuth.getState().setAuthenticated(user);
    const hydrate = vi.fn(async (): Promise<AuthStatus> => "authenticated");
    useAuth.setState({ hydrate });
    renderWithProviders(
      <RealtimeProvider>
        <span>realtime child</span>
      </RealtimeProvider>
    );
    const client = currentClient();

    act(() => {
      client.triggerTerminalAuthenticationFailure();
      client.triggerTerminalAuthenticationFailure();
    });

    await waitFor(() => expect(hydrate).toHaveBeenCalledOnce());
    await waitFor(() => expect(client.refreshAuthentication).toHaveBeenCalledOnce());
  });
});
