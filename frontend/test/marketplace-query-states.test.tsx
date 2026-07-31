import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MarketplacePage from "@/app/[locale]/marketplace/page";
import type { Product } from "@/lib/api";
import { createTestQueryClient, renderWithProviders } from "./helpers/render";

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiFetch: apiFetchMock
}));

vi.mock("@/components/ProductCard", () => ({
  ProductCard: ({ product }: { product: Product }) => <article>{product.title}</article>
}));

const offer: Product = {
  id: "offer-1",
  title: "Retained catalog offer",
  description: "A cached offer",
  priceCents: "12500",
  oldPriceCents: null,
  currency: "UAH",
  stock: 1,
  deliveryType: "manual",
  productType: "account",
  server: null,
  platform: null,
  salesCount: 0,
  isHot: false,
  isRecommended: false,
  createdAt: "2026-07-31T12:00:00.000Z",
  categorySlug: "accounts",
  categoryName: "Accounts",
  gameSlug: null,
  gameName: null,
  sectionId: null,
  sectionSlug: null,
  sectionName: null,
  sellerId: "seller-1",
  sellerDisplayName: "Seller",
  sellerRating: 5,
  sellerReviewCount: 2,
  sellerOnline: null,
  favoriteCount: 0,
  media: [],
  metadata: {},
  cardMetadata: []
};

describe("marketplace query states", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    window.history.replaceState({}, "", "/en/marketplace");
  });

  it("renders an error instead of empty and retries into success", async () => {
    apiFetchMock
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ products: [offer] });
    const user = userEvent.setup();

    renderWithProviders(<MarketplacePage />, { locale: "en" });

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this data");
    expect(screen.queryByText("No active listings yet")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText(offer.title)).toBeVisible();
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows empty only after a successful empty response", async () => {
    apiFetchMock.mockResolvedValueOnce({ products: [] });

    renderWithProviders(<MarketplacePage />, { locale: "en" });

    expect(await screen.findByText("No active listings yet")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps cached offers visible and labels a failed background refresh", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(["marketplace-products", ""], { products: [offer] });
    apiFetchMock.mockRejectedValueOnce(new Error("refresh failed"));

    renderWithProviders(<MarketplacePage />, { locale: "en", queryClient });

    expect(screen.getByText(offer.title)).toBeVisible();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Saved data is shown"));
    expect(screen.getByText(offer.title)).toBeVisible();
    expect(screen.queryByText("No active listings yet")).not.toBeInTheDocument();
  });
});
