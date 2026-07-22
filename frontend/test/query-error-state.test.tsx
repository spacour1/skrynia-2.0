import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QueryErrorState } from "@/components/QueryErrorState";
import { renderWithProviders } from "./helpers/render";

describe("QueryErrorState", () => {
  it("shows a real error instead of an empty state and invokes retry", async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<QueryErrorState message="Catalog is unavailable" onRetry={retry} />, {
      locale: "en"
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Catalog is unavailable");
    expect(screen.queryByText(/nothing found/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("labels retained stale data without hiding it", () => {
    renderWithProviders(
      <div>
        <p>Previously loaded offer</p>
        <QueryErrorState stale onRetry={() => undefined} />
      </div>,
      { locale: "en" }
    );

    expect(screen.getByText("Previously loaded offer")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Saved data is shown");
  });
});
