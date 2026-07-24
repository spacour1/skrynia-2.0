import { describe, expect, it } from "vitest";
import { strictBooleanEnvSchema } from "../src/config/env-boolean.js";

describe("strictBooleanEnvSchema", () => {
  it.each([
    [true, true],
    [false, false],
    ["true", true],
    ["false", false],
    ["1", true],
    ["0", false],
    [" TRUE ", true],
    [" False ", false]
  ])("parses %j as %s", (input, expected) => {
    expect(strictBooleanEnvSchema.parse(input)).toBe(expected);
  });

  it.each(["", "yes", "no", "on", "off", "truthy", "2", 1, 0, null])(
    "rejects unsupported value %j",
    (input) => {
      expect(strictBooleanEnvSchema.safeParse(input).success).toBe(false);
    }
  );

  it("composes with defaults and optional values without reading process.env", () => {
    expect(strictBooleanEnvSchema.default(false).parse(undefined)).toBe(false);
    expect(strictBooleanEnvSchema.default(true).parse(undefined)).toBe(true);
    expect(strictBooleanEnvSchema.optional().parse(undefined)).toBeUndefined();
  });
});
