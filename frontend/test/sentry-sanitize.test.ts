import { describe, expect, it } from "vitest";
import { sanitizeSentryEvent } from "@/lib/sentry-sanitize";

describe("Sentry sanitization", () => {
  it("removes request payloads, URL secrets, PII, and sensitive breadcrumb fields", () => {
    const secret = "do-not-send";
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.signature";
    const event = sanitizeSentryEvent({
      message: `Login failed for person+${secret}@example.test; credential=${secret}; ${jwt}; UA213223130000026007233566001; 4111 1111 1111 1111`,
      exception: {
        values: [
          {
            value: `apiKey=${secret}; Bearer ${secret} from +380501234567 and https://keepgame.test/auth/callback/${secret}?secret=${secret}`,
          },
        ],
      },
      request: {
        url: `https://keepgame.test/reset/${secret}?token=${secret}#private`,
        query_string: `token=${secret}`,
        data: { password: secret },
        cookies: { session: secret },
        headers: {
          authorization: `Bearer ${secret}`,
          cookie: `session=${secret}`,
          "content-type": "application/json",
          "x-trace-id": "trace-123",
          "x-forwarded-for": "203.0.113.7",
        },
        env: { refreshToken: secret },
      },
      transaction: `PATCH /settings?token=${secret}`,
      user: { id: "user-1", segment: "user", email: `person+${secret}@example.test`, ip_address: "203.0.113.7" },
      breadcrumbs: [
        {
          message: `jwt=${secret}`,
          data: {
            url: `wss://user:${secret}@localhost/auth/callback/${secret}?ticket=${secret}`,
            wsTicket: secret,
            nested: { path: `/settings#${secret}`, verificationCode: secret },
          },
        },
      ],
      contexts: {
        profile: { email: `person+${secret}@example.test`, apiKey: secret, safe: "kept" },
      },
      tags: { credential: secret, jwt: secret },
      extra: {
        refreshToken: secret,
        passwordHash: secret,
        privateKey: secret,
        safe: "kept",
      },
    });

    expect(event.request).toEqual({
      url: "https://keepgame.test/reset/[redacted]",
      headers: { "content-type": "application/json", "x-trace-id": "trace-123" },
    });
    expect(event.message).toBe(
      "Login failed for [redacted-email]; credential=[redacted]; [redacted-jwt]; [redacted-iban]; [redacted-number]"
    );
    expect(event.exception.values[0].value).toBe(
      "apiKey=[redacted]; Bearer [redacted] from [redacted-phone] and https://keepgame.test/auth/[redacted]"
    );
    expect(event.transaction).toBe("PATCH /settings");
    expect(event.user).toEqual({ id: "user-1", segment: "user" });
    expect(event.breadcrumbs?.[0].data).toEqual({
      url: "wss://[redacted]@localhost/auth/[redacted]",
      wsTicket: "[redacted]",
      nested: { path: "/settings", verificationCode: "[redacted]" },
    });
    expect(event.breadcrumbs?.[0].message).toBe("jwt=[redacted]");
    expect(event.contexts).toEqual({
      profile: { email: "[redacted]", apiKey: "[redacted]", safe: "kept" },
    });
    expect(event.tags).toEqual({ credential: "[redacted]", jwt: "[redacted]" });
    expect(event.extra).toEqual({
      refreshToken: "[redacted]",
      passwordHash: "[redacted]",
      privateKey: "[redacted]",
      safe: "kept",
    });
    expect(JSON.stringify(event)).not.toContain(secret);
    expect(JSON.stringify(event)).not.toContain(jwt);
    expect(JSON.stringify(event)).not.toContain("203.0.113.7");
  });
});
