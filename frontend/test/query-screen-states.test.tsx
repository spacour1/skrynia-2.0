import { useState } from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NotificationDropdown } from "@/components/nav/NavDropdowns";
import type { NotificationItem } from "@/components/nav/types";
import { renderWithProviders } from "./helpers/render";

const notification: NotificationItem = {
  id: "notification-1",
  type: "order",
  title: "Order updated",
  body: "The seller delivered your order.",
  createdAt: "2026-01-02T12:00:00.000Z"
};

const noop = () => undefined;

describe("query-backed screen states", () => {
  it("does not label an error as empty and retry can reveal successful data", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();

    function RetryableNotifications() {
      const [failed, setFailed] = useState(true);
      return (
        <NotificationDropdown
          items={failed ? [] : [notification]}
          unreadCount={failed ? 0 : 1}
          loading={false}
          error={failed}
          stale={false}
          onOpen={noop}
          onReadAll={noop}
          onRetry={() => {
            retry();
            setFailed(false);
          }}
        />
      );
    }

    renderWithProviders(<RetryableNotifications />, { locale: "en" });

    expect(screen.getByRole("alert")).toHaveTextContent("Could not load this data");
    expect(screen.queryByText(/No notifications yet/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(await screen.findByText("Order updated")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows empty only after a successful empty response", () => {
    renderWithProviders(
      <NotificationDropdown
        items={[]}
        unreadCount={0}
        loading={false}
        error={false}
        stale={false}
        onOpen={noop}
        onReadAll={noop}
        onRetry={noop}
      />,
      { locale: "en" }
    );

    expect(screen.getByText(/No notifications yet/)).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps stale data visible beside a refetch error", () => {
    renderWithProviders(
      <NotificationDropdown
        items={[notification]}
        unreadCount={1}
        loading={false}
        error={false}
        stale
        onOpen={noop}
        onReadAll={noop}
        onRetry={noop}
      />,
      { locale: "en" }
    );

    expect(screen.getByText("Order updated")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Saved data is shown");
  });
});
