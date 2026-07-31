import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Swords } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { MarketplaceCategoryLink } from "@/components/MarketplaceCategoryLink";
import { ProductCard } from "@/components/ProductCard";
import {
  GameCatalogOfferRow,
  RelatedGames
} from "@/app/[locale]/games/[slug]/GameCatalogClient";
import type { Game, Product } from "@/lib/api";
import { CurrencyProvider } from "@/lib/currency";
import { installFetchMock, jsonResponse } from "./helpers/fetch";
import { renderWithProviders } from "./helpers/render";

const product: Product = {
  id: "product-123",
  title: "Semantic product offer",
  description: "A listing that can be opened in a new tab.",
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
  sellerId: "seller-456",
  sellerDisplayName: "Seller",
  sellerRating: 4.8,
  sellerReviewCount: 3,
  sellerOnline: null,
  favoriteCount: 0,
  media: [],
  metadata: {},
  cardMetadata: []
};

describe("marketplace navigation", () => {
  it("keeps the category slug in a localized marketplace filter href", () => {
    renderWithProviders(
      <MarketplaceCategoryLink
        category={{ slug: "accounts", activeProductCount: 7 }}
        Icon={Swords}
        label="Accounts"
        itemsLabel="items"
      />,
      { locale: "ru" }
    );

    expect(screen.getByRole("link", { name: /accounts/i })).toHaveAttribute(
      "href",
      "/ru/marketplace?category=accounts"
    );
  });

  it("renders a native localized product anchor without a forced target", () => {
    installFetchMock([{ path: "/currencies", response: jsonResponse({ baseCurrency: "UAH", rates: [] }) }]);
    renderWithProviders(<CurrencyProvider><ProductCard product={product} /></CurrencyProvider>, { locale: "en" });

    const productLink = screen.getByRole("link", { name: product.title });
    expect(productLink.tagName).toBe("A");
    expect(productLink).toHaveAttribute("href", "/en/products/product-123");
    expect(productLink).not.toHaveAttribute("target");
    expect(productLink).not.toHaveAttribute("role", "link");
  });

  it("renders related games as native localized anchors", async () => {
    const games: Game[] = [
      { id: "game-cs2", slug: "cs2", name: "Counter-Strike 2", createdAt: "2026-07-31T12:00:00.000Z" },
      { id: "game-valorant", slug: "valorant", name: "Valorant", createdAt: "2026-07-31T12:00:00.000Z" }
    ];
    installFetchMock([
      { path: "/api/marketplace/games", response: jsonResponse({ games }) }
    ]);

    renderWithProviders(<RelatedGames currentSlug="cs2" />, { locale: "en" });

    const gameLink = await screen.findByRole("link", { name: /valorant/i });
    expect(gameLink.tagName).toBe("A");
    expect(gameLink).toHaveAttribute("href", "/en/games/valorant");
    expect(gameLink).not.toHaveAttribute("target");
  });

  it("keeps favorite interaction isolated from the product link", async () => {
    const user = userEvent.setup();
    const onToggleFavorite = vi.fn();
    installFetchMock([
      { path: "/api/currencies", response: jsonResponse({ baseCurrency: "UAH", rates: [] }) }
    ]);
    window.history.replaceState({}, "", "/en/games/cs2");

    renderWithProviders(
      <CurrencyProvider>
        <GameCatalogOfferRow
          product={product}
          index={0}
          liked={false}
          onToggleFavorite={onToggleFavorite}
        />
      </CurrencyProvider>,
      { locale: "en" }
    );

    const productLink = screen.getByRole("link", { name: product.title });
    expect(productLink).toHaveAttribute("href", "/en/products/product-123");
    await user.click(screen.getByRole("button", { name: /favorite/i }));

    expect(onToggleFavorite).toHaveBeenCalledWith(false);
    expect(window.location.pathname).toBe("/en/games/cs2");
  });
});
