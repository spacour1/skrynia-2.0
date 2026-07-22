import { screen } from "@testing-library/react";
import { Swords } from "lucide-react";
import { describe, expect, it } from "vitest";
import { MarketplaceCategoryLink } from "@/components/MarketplaceCategoryLink";
import { ProductCard } from "@/components/ProductCard";
import type { Product } from "@/lib/api";
import { CurrencyProvider } from "@/lib/currency";
import { installFetchMock, jsonResponse } from "./helpers/fetch";
import { renderWithProviders } from "./helpers/render";

const product: Product = {
  id: "product-123",
  title: "Semantic product offer",
  description: "A listing that can be opened in a new tab.",
  priceCents: "12500",
  currency: "UAH",
  stock: 1,
  sellerId: "seller-456",
  sellerDisplayName: "Seller",
  sellerRating: 4.8,
  sellerReviewCount: 3
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
});
