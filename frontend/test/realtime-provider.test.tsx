import { act, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthStatus } from "@/lib/auth-store";
import { useAuth } from "@/lib/auth-store";
import { RealtimeProvider } from "@/components/RealtimeProvider";
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
  role: "user" as const
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
