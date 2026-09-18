import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("server API cache policy", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.test");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("retains the default timed cache for reads that explicitly tolerate staleness", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ value: "current" }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchServerSide } = await import("@/lib/server-api");

    await expect(fetchServerSide("/reference")).resolves.toEqual({ value: "current" });
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.test/reference", {
      next: { revalidate: 60 }
    });
  });

  it("preserves a caller-specified positive revalidation interval", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchServerSide } = await import("@/lib/server-api");

    await fetchServerSide("/reference", 120);
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.test/reference", {
      next: { revalidate: 120 }
    });
  });

  it.each([0, -1])("uses no-store with no conflicting Next cache option for interval %s", async (interval) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchServerSide } = await import("@/lib/server-api");

    await fetchServerSide("/moderation-sensitive", interval);
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.test/moderation-sensitive", {
      cache: "no-store"
    });
  });

  it("does not reuse the previous value after an uncached resource becomes unavailable", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ title: "Visible listing" }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockRejectedValueOnce(new Error("Test-only unavailable backend"));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchServerSide } = await import("@/lib/server-api");

    await expect(fetchServerSide("/moderation-sensitive", 0)).resolves.toEqual({ title: "Visible listing" });
    await expect(fetchServerSide("/moderation-sensitive", 0)).resolves.toBeNull();
    await expect(fetchServerSide("/moderation-sensitive", 0)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, options] of fetchMock.mock.calls) {
      expect(options).toEqual({ cache: "no-store" });
    }
  });
});
