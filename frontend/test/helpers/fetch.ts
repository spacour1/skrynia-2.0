import { expect, vi } from "vitest";

type FetchMatch = {
  method?: string;
  path: string | RegExp;
  response: Response | (() => Response | Promise<Response>);
};

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function installFetchMock(matches: FetchMatch[]) {
  const pending = [...matches];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const request = input instanceof Request
      ? input
      : new Request(new URL(input instanceof URL ? input.href : input, window.location.origin), init);
    const url = new URL(request.url, window.location.origin);
    const index = pending.findIndex((match) => {
      const methodMatches = !match.method || match.method.toUpperCase() === request.method.toUpperCase();
      const pathMatches = typeof match.path === "string"
        ? `${url.pathname}${url.search}` === match.path
        : match.path.test(`${url.pathname}${url.search}`);
      return methodMatches && pathMatches;
    });

    if (index < 0) {
      throw new Error(`Unexpected fetch: ${request.method} ${url.pathname}${url.search}`);
    }

    const [match] = pending.splice(index, 1);
    return typeof match.response === "function" ? match.response() : match.response;
  });

  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    assertAllUsed: () => expect(pending, "unconsumed fetch expectations").toEqual([])
  };
}
