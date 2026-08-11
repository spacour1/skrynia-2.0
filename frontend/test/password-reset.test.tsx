import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ResetPasswordPage from "@/app/[locale]/reset-password/page";
import { renderWithProviders } from "./helpers/render";

const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiFetch: apiFetchMock };
});

describe("password reset page", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({});
    window.history.replaceState({}, "", "/en/reset-password?token=reset-token");
  });

  it("submits the route token and matching password through the API rewrite", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResetPasswordPage />);

    await user.type(screen.getByPlaceholderText("New password"), "strong-password-123");
    await user.type(
      screen.getByPlaceholderText("Repeat new password"),
      "strong-password-123"
    );
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith("/auth/password/reset", {
        method: "POST",
        body: JSON.stringify({
          token: "reset-token",
          password: "strong-password-123"
        })
      });
    });
    expect(
      screen.getByRole("heading", { name: "Password reset. You can log in now." })
    ).toBeVisible();
  });
});
