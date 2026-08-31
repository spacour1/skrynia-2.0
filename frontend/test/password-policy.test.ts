import { describe, expect, it } from "vitest";
import { isStrongPassword } from "@/app/[locale]/settings/_components/settings-state";

describe("password policy preflight", () => {
  it("counts Unicode code points and does not impose composition rules", () => {
    expect(isStrongPassword("длинная пароль-фраза")).toBe(true);
    expect(isStrongPassword("short-pass")).toBe(false);
    expect(isStrongPassword("😀😀😀😀")).toBe(false);
  });

  it("matches the backend bcrypt byte boundary", () => {
    expect(isStrongPassword("a".repeat(72))).toBe(true);
    expect(isStrongPassword("a".repeat(73))).toBe(false);
    expect(isStrongPassword("😀".repeat(18))).toBe(true);
    expect(isStrongPassword(`😀${"a".repeat(69)}`)).toBe(false);
  });
});
