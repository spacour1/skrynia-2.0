import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ProductPage, { generateMetadata } from "@/app/[locale]/products/[id]/page";

const { fetchServerSideMock } = vi.hoisted(() => ({ fetchServerSideMock: vi.fn() }));

vi.mock("@/lib/server-api", () => ({ fetchServerSide: fetchServerSideMock }));
vi.mock("@/lib/site", () => ({ SITE_NAME: "KeepGame", SITE_URL: "https://app.example.test" }));
vi.mock("@/i18n/dictionaries", () => ({ getT: () => (key: string) => key }));
vi.mock("@/app/[locale]/products/[id]/ProductPageClient", () => ({
  ProductPageClient: ({ id }: { id: string }) => <div data-testid="product-client">{id}</div>
}));

describe("product server moderation visibility", () => {
  beforeEach(() => fetchServerSideMock.mockReset());

  it("reads metadata without independent cache and drops public metadata after moderation", async () => {
    fetchServerSideMock
      .mockResolvedValueOnce({ product: {
        id: "moderated-product",
        title: "Previously visible title",
        description: "Previously visible description",
        media: [{ url: "https://media.example.test/visible.webp" }]
      } })
      .mockResolvedValueOnce(null);
    const params = Promise.resolve({ id: "moderated-product", locale: "en" });

    const before = await generateMetadata({ params });
    const after = await generateMetadata({ params });

    expect(before).toMatchObject({
      title: "Previously visible title",
      alternates: { canonical: "https://app.example.test/en/products/moderated-product" }
    });
    expect(after).toEqual({ title: "product.notFound" });
    expect(fetchServerSideMock).toHaveBeenCalledTimes(2);
    for (const args of fetchServerSideMock.mock.calls) {
      expect(args).toEqual(["/marketplace/products/moderated-product", 0]);
    }
  });

  it("omits structured listing metadata when the backend no longer exposes the product", async () => {
    fetchServerSideMock.mockResolvedValueOnce(null);

    const page = await ProductPage({ params: Promise.resolve({ id: "moderated-product" }) });
    const { container } = render(page);

    expect(fetchServerSideMock).toHaveBeenCalledWith("/marketplace/products/moderated-product", 0);
    expect(container.querySelector('script[type="application/ld+json"]')).toBeNull();
    expect(screen.getByTestId("product-client")).toHaveTextContent("moderated-product");
  });
});
