import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

export const navigationMock = {
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn()
};

vi.mock("next/navigation", () => ({
  useRouter: () => navigationMock,
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
  redirect: vi.fn(),
  notFound: vi.fn()
}));

class TestBroadcastChannel extends EventTarget {
  static channels = new Map<string, Set<TestBroadcastChannel>>();

  constructor(readonly name: string) {
    super();
    const peers = TestBroadcastChannel.channels.get(name) ?? new Set<TestBroadcastChannel>();
    peers.add(this);
    TestBroadcastChannel.channels.set(name, peers);
  }

  postMessage(data: unknown) {
    for (const peer of TestBroadcastChannel.channels.get(this.name) ?? []) {
      if (peer !== this) peer.dispatchEvent(new MessageEvent("message", { data }));
    }
  }

  close() {
    TestBroadcastChannel.channels.get(this.name)?.delete(this);
  }
}

if (!("BroadcastChannel" in globalThis)) {
  Object.defineProperty(globalThis, "BroadcastChannel", {
    configurable: true,
    writable: true,
    value: TestBroadcastChannel
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  navigationMock.push.mockReset();
  navigationMock.replace.mockReset();
  navigationMock.prefetch.mockReset();
  navigationMock.back.mockReset();
  navigationMock.forward.mockReset();
  navigationMock.refresh.mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
