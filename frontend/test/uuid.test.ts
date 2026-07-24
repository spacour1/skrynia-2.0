import { afterEach, expect, it, vi } from "vitest";
import { createClientUuid } from "@/lib/uuid";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("uses native randomUUID when the browser exposes it", () => {
  const randomUUID = vi.fn(
    () => "09e92617-2fa5-4a3e-a600-89b1edcc92d2" as `${string}-${string}-${string}-${string}-${string}`
  );
  vi.stubGlobal("crypto", {
    getRandomValues: vi.fn(),
    randomUUID
  });

  expect(createClientUuid()).toBe("09e92617-2fa5-4a3e-a600-89b1edcc92d2");
  expect(randomUUID).toHaveBeenCalledOnce();
});

it("creates an RFC 4122 v4 UUID when randomUUID is unavailable on an insecure origin", () => {
  const source = Uint8Array.from([
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
    0xc8, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f
  ]);
  const getRandomValues = vi.fn((target: Uint8Array) => {
    target.set(source);
    return target;
  });
  vi.stubGlobal("crypto", { getRandomValues });

  expect(createClientUuid()).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  expect(getRandomValues).toHaveBeenCalledOnce();
});
