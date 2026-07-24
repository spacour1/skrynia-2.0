import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "@/components/ChatPanel";
import { useAuth } from "@/lib/auth-store";
import { renderWithProviders } from "./helpers/render";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
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
});
