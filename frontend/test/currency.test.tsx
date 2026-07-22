import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  CurrencyProvider,
  absMoneyCents,
  calculateDiscountPercent,
  formatMoney,
  isPositiveMoneyCents,
  majorUnitsToMoneyCents,
  moneyCentsToMajorUnits,
  multiplyMoneyCentsByRatio,
  parseCurrencyRates,
  subtractMoneyCents,
  sumMoneyCents,
  sumMoneyCentsByCurrency,
  useCurrency,
  useMoney,
  type CurrencyRates
} from "@/lib/currency";
import { renderWithProviders } from "./helpers/render";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiFetch: vi.fn(async () => ({
    baseCurrency: "UAH",
    rates: [
      { code: "UAH", rateToUah: "1", source: "test", asOf: "2026-01-01", updatedAt: "2026-01-01" },
      { code: "USD", rateToUah: "40", source: "test", asOf: "2026-01-01", updatedAt: "2026-01-01" },
      { code: "EUR", rateToUah: "45", source: "test", asOf: "2026-01-01", updatedAt: "2026-01-01" }
    ]
  }))
}));

const exactRates: CurrencyRates = {
  UAH: { value: 1n, scale: 0 },
  USD: { value: 401234n, scale: 4 },
  EUR: { value: 0n, scale: 0 }
};

describe("currency formatting", () => {
  it("formats bigint and decimal-string cents with exact scaled rates", () => {
    const input = "401234";
    expect(formatMoney({ cents: input, sourceCurrency: "UAH", displayCurrency: "USD", rates: exactRates, locale: "en" })).toBe("100.00 $");
    expect(formatMoney({ cents: 401234n, sourceCurrency: "UAH", displayCurrency: "USD", rates: exactRates, locale: "en" })).toBe("100.00 $");
    expect(input).toBe("401234");
    expect(formatMoney({ cents: input, sourceCurrency: "UAH", displayCurrency: "EUR", rates: exactRates, locale: "en" })).toBe("4,012.34 ₴");
  });

  it("preserves the source amount and symbol when the target rate is missing or invalid", () => {
    expect(formatMoney({ cents: "12345", sourceCurrency: "USD", displayCurrency: "EUR", rates: exactRates, locale: "en" })).toBe("123.45 $");
    expect(formatMoney({
      cents: "12345",
      sourceCurrency: "USD",
      displayCurrency: "EUR",
      rates: { ...exactRates, EUR: { value: -1n, scale: 0 } },
      locale: "en"
    })).toBe("123.45 $");
  });

  it("rejects hostile, unknown, negative and zero exchange rates", () => {
    const parsed = parseCurrencyRates([
      { code: "BTC" as never, rateToUah: "1", source: "test", asOf: "2026-01-01", updatedAt: "2026-01-01" },
      { code: "USD", rateToUah: "1e999999999", source: "test", asOf: "2026-01-01", updatedAt: "2026-01-01" },
      { code: "EUR", rateToUah: "-40", source: "test", asOf: "2026-01-01", updatedAt: "2026-01-01" },
      { code: "UAH", rateToUah: "0", source: "test", asOf: "2026-01-01", updatedAt: "2026-01-01" }
    ]);
    expect(parsed).toEqual({
      UAH: { value: 1n, scale: 0 },
      USD: { value: 0n, scale: 0 },
      EUR: { value: 0n, scale: 0 }
    });
  });

  it("formats wire amounts above Number.MAX_SAFE_INTEGER without precision loss", () => {
    expect(formatMoney({
      cents: "900719925474099312345",
      sourceCurrency: "USD",
      displayCurrency: "USD",
      rates: exactRates,
      locale: "en"
    })).toBe("9,007,199,254,740,993,123.45 $");
  });

  it("keeps aggregates, differences, discounts and major-unit strings exact", () => {
    expect(sumMoneyCents(["9007199254740993", "7", -5n])).toBe(9007199254740995n);
    expect(absMoneyCents(subtractMoneyCents("2", "9007199254740993"))).toBe(9007199254740991n);
    expect(calculateDiscountPercent("9000000000000000000", "12000000000000000000")).toBe(25);
    expect(majorUnitsToMoneyCents("9007199254740993.45")).toBe(900719925474099345n);
    expect(moneyCentsToMajorUnits("900719925474099345")).toBe("9007199254740993.45");
    expect(multiplyMoneyCentsByRatio("1999", 25n, 1000n)).toBe(50n);
    expect(isPositiveMoneyCents("0")).toBe(false);
    expect(isPositiveMoneyCents("1")).toBe(true);

    const grouped = sumMoneyCentsByCurrency([
      { currency: "UAH", cents: "9007199254740993" },
      { currency: "USD", cents: "11" },
      { currency: "UAH", cents: "9" }
    ]);
    expect(grouped.get("UAH")).toBe(9007199254741002n);
    expect(grouped.get("USD")).toBe(11n);
  });

  it("rejects unsafe numeric money inputs", () => {
    expect(() => formatMoney({
      cents: Number.MAX_SAFE_INTEGER + 1,
      sourceCurrency: "UAH",
      displayCurrency: "UAH",
      rates: exactRates,
      locale: "en"
    })).toThrow("Money cents must be a safe integer");
  });

  it("updates subscribed prices without remounting the application subtree or losing client state", async () => {
    const user = userEvent.setup();
    const mounts = vi.fn();
    const unmounts = vi.fn();
    let childInstances = 0;

    function StableChild() {
      const [instance] = useState(() => ++childInstances);
      useEffect(() => {
        mounts();
        return () => unmounts();
      }, []);
      return <output aria-label="child-instance">{instance}</output>;
    }

    function Probe() {
      const { setDisplayCurrency, setRates, rates } = useCurrency();
      const money = useMoney();
      const [draft, setDraft] = useState("");
      const [modalOpen, setModalOpen] = useState(false);
      const [counter, setCounter] = useState(0);
      const cached = useQuery({ queryKey: ["currency-probe-cache"], queryFn: async () => "cached", initialData: "cached" });
      useEffect(() => {
        setRates([
          { code: "UAH", rateToUah: "1", source: "test", asOf: "2026-01-01", updatedAt: "2026-01-01" },
          { code: "USD", rateToUah: "40", source: "test", asOf: "2026-01-01", updatedAt: "2026-01-01" },
          { code: "EUR", rateToUah: "45", source: "test", asOf: "2026-01-01", updatedAt: "2026-01-01" }
        ]);
      }, [setRates]);
      return (
        <div>
          <output aria-label="price">{money(50_000, "UAH")}</output>
          <output aria-label="usd-rate">{rates.USD.value.toString()}</output>
          <input aria-label="draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
          <button onClick={() => setModalOpen((open) => !open)}>toggle modal</button>
          <button onClick={() => setCounter((value) => value + 1)}>increment</button>
          <button onClick={() => setDisplayCurrency("USD")}>show USD</button>
          {modalOpen ? <div role="dialog">open</div> : null}
          <output aria-label="counter">{counter}</output>
          <output aria-label="query-cache">{cached.data}</output>
          <StableChild />
        </div>
      );
    }

    renderWithProviders(<CurrencyProvider><Probe /></CurrencyProvider>);
    await waitFor(() => expect(screen.getByLabelText("usd-rate")).toHaveTextContent("40"));
    await user.type(screen.getByLabelText("draft"), "keep this draft");
    await user.click(screen.getByRole("button", { name: "toggle modal" }));
    await user.click(screen.getByRole("button", { name: "increment" }));
    await user.click(screen.getByRole("button", { name: "show USD" }));

    expect(await screen.findByLabelText("price")).toHaveTextContent("12.50 $");
    expect(screen.getByLabelText("draft")).toHaveValue("keep this draft");
    expect(screen.getByRole("dialog")).toHaveTextContent("open");
    expect(screen.getByLabelText("counter")).toHaveTextContent("1");
    expect(screen.getByLabelText("query-cache")).toHaveTextContent("cached");
    expect(screen.getByLabelText("child-instance")).toHaveTextContent("1");
    expect(mounts).toHaveBeenCalledOnce();
    expect(unmounts).not.toHaveBeenCalled();
  });
});
