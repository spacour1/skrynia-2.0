import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useLocale } from "@/lib/i18n";
import { installFetchMock, jsonResponse } from "./helpers/fetch";
import { renderWithProviders } from "./helpers/render";

function FoundationProbe() {
  const locale = useLocale();
  const [draft, setDraft] = useState(() => window.localStorage.getItem("draft") ?? "");
  const [online, setOnline] = useState(navigator.onLine);
  const result = useQuery({
    queryKey: ["foundation"],
    queryFn: () => fetch("/fixture").then((response) => response.json() as Promise<{ value: string }>)
  });

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return (
    <div>
      <label>
        Draft
        <input
          aria-label="Draft"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            window.localStorage.setItem("draft", event.target.value);
          }}
        />
      </label>
      <output>{result.data?.value ?? "loading"}</output>
      <span>{locale}</span>
      <span>{online ? "online" : "offline"}</span>
    </div>
  );
}

describe("frontend test foundation", () => {
  it("renders React Query and locale providers with strict fetch mocks", async () => {
    const requests = installFetchMock([
      { path: "/fixture", response: jsonResponse({ value: "ready" }) }
    ]);

    renderWithProviders(<FoundationProbe />, { locale: "ua" });

    expect(await screen.findByText("ready")).toBeInTheDocument();
    expect(screen.getByText("ua")).toBeInTheDocument();
    requests.assertAllUsed();
  });

  it("supports user events, localStorage, online events, and deterministic timers", async () => {
    installFetchMock([{ path: "/fixture", response: jsonResponse({ value: "ready" }) }]);
    const user = userEvent.setup();
    renderWithProviders(<FoundationProbe />);

    await user.type(screen.getByLabelText("Draft"), "saved text");
    expect(window.localStorage.getItem("draft")).toBe("saved text");

    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    window.dispatchEvent(new Event("offline"));
    expect(await screen.findByText("offline")).toBeInTheDocument();

    vi.useFakeTimers();
    const callback = vi.fn();
    setTimeout(callback, 1_000);
    vi.advanceTimersByTime(1_000);
    expect(callback).toHaveBeenCalledOnce();
  });
});
