import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "@/components/ChatPanel";
import { useAuth } from "@/lib/auth-store";
import { RealtimeMessageError } from "@/lib/realtime-client";
import { renderWithProviders } from "./helpers/render";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  getSnapshot: vi.fn(),
  joinConversation: vi.fn(() => () => undefined),
  sendMessage: vi.fn(),
  subscribe: vi.fn(() => () => undefined)
}));

vi.mock("@sentry/nextjs", () => ({ setUser: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiFetch: mocks.apiFetch
  };
});

vi.mock("@/components/RealtimeProvider", () => ({
  useRealtime: () => ({
    getSnapshot: mocks.getSnapshot,
    joinConversation: mocks.joinConversation,
    sendMessage: mocks.sendMessage,
    subscribe: mocks.subscribe
  }),
  useRealtimeStatus: () => ({
    status: "connected",
    reconnectAttempt: 0,
    error: null
  })
}));

const authenticatedUser = {
  id: "buyer-id",
  email: "buyer@example.com",
  displayName: "Buyer",
  role: "user" as const
};

const originalScrollTo = HTMLElement.prototype.scrollTo;

describe("ChatPanel", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn()
    });
  });

  afterAll(() => {
    if (originalScrollTo) {
      Object.defineProperty(HTMLElement.prototype, "scrollTo", {
        configurable: true,
        value: originalScrollTo
      });
    } else {
      delete (HTMLElement.prototype as { scrollTo?: typeof HTMLElement.prototype.scrollTo }).scrollTo;
    }
  });

  beforeEach(() => {
    useAuth.setState({
      user: authenticatedUser,
      status: "authenticated",
      hydrated: true
    });
    mocks.apiFetch.mockImplementation(() => new Promise(() => undefined));
    mocks.getSnapshot.mockReturnValue({
      status: "connected",
      reconnectAttempt: 0,
      error: null
    });
    mocks.sendMessage.mockImplementation(async (input: {
      clientMessageId: string;
      conversationId: string;
      body: string;
    }) => ({
      id: "persisted-message-id",
      clientMessageId: input.clientMessageId,
      conversationId: input.conversationId,
      senderId: authenticatedUser.id,
      senderDisplayName: authenticatedUser.displayName,
      body: input.body,
      createdAt: "2026-07-24T12:00:00.000Z"
    }));
  });

  it("uses the connected socket for the first message after creating a conversation", async () => {
    const user = userEvent.setup();
    const ensureConversation = vi.fn().mockResolvedValue({
      conversationId: "new-conversation-id"
    });
    const onConversationReady = vi.fn();

    renderWithProviders(
      <ChatPanel
        conversationId={null}
        mode="compact"
        ensureConversation={ensureConversation}
        onConversationReady={onConversationReady}
      />,
      { locale: "en" }
    );

    await user.type(screen.getByPlaceholderText("Write a message"), "First websocket message");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(mocks.sendMessage).toHaveBeenCalledWith({
        clientMessageId: expect.any(String),
        conversationId: "new-conversation-id",
        body: "First websocket message",
        attachmentUploadId: undefined
      });
    });
    expect(ensureConversation).toHaveBeenCalledOnce();
    expect(onConversationReady).toHaveBeenCalledWith("new-conversation-id");
    expect(
      mocks.apiFetch.mock.calls.some(([, options]) => options?.method === "POST")
    ).toBe(false);
    expect(await screen.findByText("Sent")).toBeVisible();
  });

  it("preserves sent delivery state when history arrives after the socket ACK", async () => {
    const user = userEvent.setup();
    let resolveHistory!: (value: {
      messages: Array<{
        id: string;
        clientMessageId: string;
        conversationId: string;
        senderId: string;
        senderDisplayName: string;
        body: string;
        createdAt: string;
      }>;
    }) => void;
    mocks.apiFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveHistory = resolve;
        })
    );

    renderWithProviders(
      <ChatPanel
        conversationId="existing-conversation-id"
        mode="compact"
      />,
      { locale: "en" }
    );

    await user.type(screen.getByPlaceholderText("Write a message"), "Late history");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledOnce());
    expect(await screen.findByText("Sent")).toBeVisible();

    const socketInput = mocks.sendMessage.mock.calls[0][0] as {
      clientMessageId: string;
    };
    resolveHistory({
      messages: [
        {
          id: "persisted-message-id",
          clientMessageId: socketInput.clientMessageId,
          conversationId: "existing-conversation-id",
          senderId: authenticatedUser.id,
          senderDisplayName: authenticatedUser.displayName,
          body: "Late history",
          createdAt: "2026-07-24T12:00:00.000Z"
        }
      ]
    });

    await waitFor(() => {
      expect(screen.getByText("Sent")).toBeVisible();
      expect(screen.getAllByText("Late history")).toHaveLength(1);
    });
  });

  it("falls back to idempotent REST when the live socket drops before send", async () => {
    const user = userEvent.setup();
    mocks.sendMessage.mockRejectedValueOnce(
      new RealtimeMessageError(
        "Realtime connection is not available",
        true,
        "not_connected"
      )
    );
    mocks.apiFetch.mockImplementation(
      async (
        path: string,
        options?: {
          method?: string;
          body?: string;
        }
      ) => {
        if (options?.method !== "POST") return new Promise(() => undefined);
        const input = JSON.parse(options.body ?? "{}") as {
          clientMessageId: string;
          body: string;
        };
        return {
          message: {
            id: "rest-persisted-message-id",
            clientMessageId: input.clientMessageId,
            conversationId: "existing-conversation-id",
            senderId: authenticatedUser.id,
            senderDisplayName: authenticatedUser.displayName,
            body: input.body,
            createdAt: "2026-07-24T12:00:00.000Z"
          }
        };
      }
    );

    renderWithProviders(
      <ChatPanel
        conversationId="existing-conversation-id"
        mode="compact"
      />,
      { locale: "en" }
    );

    await user.type(screen.getByPlaceholderText("Write a message"), "Transport fallback");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledOnce());
    const socketInput = mocks.sendMessage.mock.calls[0][0] as {
      clientMessageId: string;
    };
    const restCall = mocks.apiFetch.mock.calls.find(
      ([, options]) => options?.method === "POST"
    );
    expect(restCall).toBeDefined();
    expect(restCall?.[0]).toBe(
      "/chat/conversations/existing-conversation-id/messages"
    );
    expect(JSON.parse(restCall?.[1]?.body as string)).toEqual({
      clientMessageId: socketInput.clientMessageId,
      body: "Transport fallback"
    });
    expect(await screen.findByText("Sent")).toBeVisible();
  });
});
