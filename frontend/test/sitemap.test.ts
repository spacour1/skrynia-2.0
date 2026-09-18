import { describe, expect, it, vi } from "vitest";
import sitemap, { revalidate } from "@/app/sitemap";

vi.mock("@/lib/site", () => ({ SITE_URL: "https://app.example.test" }));

function requestUrl(input: string) {
  return new URL(input);
}

describe("moderation-sensitive sitemap", () => {
  it("uses uncached newest keyset pages and preserves opaque cursor encoding", async () => {
    const cursor = "opaque+/=cursor";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ games: [{ slug: "visible-game" }] }))
      .mockResolvedValueOnce(Response.json({ products: [{ id: "first", createdAt: "2026-09-01T12:00:00Z" }], nextCursor: cursor }))
      .mockResolvedValueOnce(Response.json({ products: [{ id: "second" }], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);

    const entries = await sitemap();

    expect(revalidate).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(requestUrl(fetchMock.mock.calls[0][0]).pathname).toBe("/marketplace/games");
    const firstPage = requestUrl(fetchMock.mock.calls[1][0]);
    expect(firstPage.pathname).toBe("/marketplace/products");
    expect(Object.fromEntries(firstPage.searchParams)).toEqual({ sort: "newest", limit: "100" });
    const secondPage = requestUrl(fetchMock.mock.calls[2][0]);
    expect(Object.fromEntries(secondPage.searchParams)).toEqual({ sort: "newest", limit: "100", cursor });
    for (const [, options] of fetchMock.mock.calls) {
      expect(options).toEqual({ cache: "no-store" });
    }
    expect(entries.map((entry) => entry.url)).toEqual([
      "https://app.example.test/ua",
      "https://app.example.test/ua/rules",
      "https://app.example.test/ua/support",
      "https://app.example.test/ua/games/visible-game",
      "https://app.example.test/ua/products/first",
      "https://app.example.test/ua/products/second"
    ]);
    expect(entries[4]).toMatchObject({
      lastModified: new Date("2026-09-01T12:00:00Z"),
      alternates: { languages: {
        uk: "https://app.example.test/ua/products/first",
        ru: "https://app.example.test/ru/products/first",
        en: "https://app.example.test/en/products/first"
      } }
    });
  });

  it.each([
    ["repeated cursor", ["cursor-a", "cursor-a"]],
    ["multi-page cycle", ["cursor-a", "cursor-b", "cursor-a"]]
  ])("bounds a malformed backend %s", async (_description, cursors) => {
    let productPages = 0;
    const fetchMock = vi.fn().mockImplementation(async (input: string) => {
      if (requestUrl(input).pathname === "/marketplace/games") return Response.json({ games: [] });
      const page = productPages++;
      if (page >= cursors.length) throw new Error("Sitemap followed a cyclic cursor");
      return Response.json({ products: [{ id: `product-${page}` }], nextCursor: cursors[page] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const entries = await sitemap();

    expect(productPages).toBe(cursors.length);
    expect(fetchMock).toHaveBeenCalledTimes(cursors.length + 1);
    expect(entries).toHaveLength(cursors.length + 3);
  });

  it("bounds output and requests even when every backend page has another cursor", async () => {
    let productPages = 0;
    const fetchMock = vi.fn().mockImplementation(async (input: string) => {
      if (requestUrl(input).pathname === "/marketplace/games") return Response.json({ games: [] });
      const page = productPages++;
      return Response.json({
        products: Array.from({ length: 100 }, (_, index) => ({ id: `${page}-${index}` })),
        nextCursor: `cursor-${page}`
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const entries = await sitemap();

    expect(entries).toHaveLength(2000);
    expect(productPages).toBe(20);
    expect(new Set(entries.map((entry) => entry.url)).size).toBe(2000);
  });

  it("stops on an empty page even if the backend supplies another cursor", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ games: [] }))
      .mockResolvedValueOnce(Response.json({ products: [], nextCursor: "unexpected-cursor" }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await sitemap()).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retains static and game routes when the product endpoint is unavailable", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ games: [{ slug: "visible-game" }] }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const entries = await sitemap();

    expect(entries).toHaveLength(4);
    expect(entries[3].url).toBe("https://app.example.test/ua/games/visible-game");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retain a removed product across sitemap invocations", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ games: [] }))
      .mockResolvedValueOnce(Response.json({ products: [{ id: "later-hidden" }], nextCursor: null }))
      .mockResolvedValueOnce(Response.json({ games: [] }))
      .mockResolvedValueOnce(Response.json({ products: [], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);

    const before = await sitemap();
    const after = await sitemap();

    expect(before.some((entry) => entry.url.endsWith("/products/later-hidden"))).toBe(true);
    expect(after.some((entry) => entry.url.endsWith("/products/later-hidden"))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [, options] of fetchMock.mock.calls) {
      expect(options).toEqual({ cache: "no-store" });
    }
  });
});
