import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/auth-store";
import { renderWithProviders } from "./helpers/render";

describe("authenticated route navigation", () => {
  beforeEach(() => {
    useAuth.setState({ user: null, status: "anonymous", hydrated: true });
    window.history.replaceState({}, "", "/en/orders/order-123");
  });

  it("preserves the protected return path in the localized login link", () => {
    renderWithProviders(
      <RequireAuth>
        <div>private content</div>
      </RequireAuth>
    );

    expect(screen.queryByText("private content")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Login" })).toHaveAttribute(
      "href",
      "/en/login?next=%2Forders%2Forder-123"
    );
  });
});
