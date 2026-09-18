import { expect, test } from "@playwright/test";
import { rawApi, registerVerifiedActor } from "./helpers.js";

test("production-built pages enforce the browser policy without breaking hydration", async ({ page, request }) => {
  const violations: string[] = [];
  await page.exposeFunction("recordSecurityViolation", (directive: string) => violations.push(directive));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      void (window as unknown as { recordSecurityViolation: (directive: string) => Promise<void> })
        .recordSecurityViolation(event.violatedDirective);
    });
  });
  page.on("console", (message) => {
    if (/violates.*Content Security Policy|Refused to.*Content Security Policy/i.test(message.text())) {
      violations.push(message.text());
    }
  });
  const response = await page.goto("/en/login");
  expect(response?.status()).toBe(200);
  const headers = response!.headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).not.toContain("unsafe-eval");
  expect(headers["content-security-policy-report-only"]).toBeUndefined();
  // The isolated fixture serves HTTP: it must never advertise production HSTS.
  expect(headers["strict-transport-security"]).toBeUndefined();
  await page.getByPlaceholder("Email").fill("security-smoke@example.test");
  await expect(page.getByPlaceholder("Email")).toHaveValue("security-smoke@example.test");
  await page.getByPlaceholder("Password", { exact: true }).fill("SyntheticWrongPassword123!");
  // A client POST and the resulting React error state prove hydration; DOM fill alone
  // also works on a non-interactive server-rendered page.
  const loginResult = page.waitForResponse((result) =>
    new URL(result.url()).pathname === "/api/auth/login" && result.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Login", exact: true }).click();
  expect((await loginResult).status()).toBe(400);
  await expect(page.getByText(/invalid email or password/i)).toBeVisible();
  expect(violations).toEqual([]);

  for (const path of ["/en/marketplace", "/robots.txt", "/sitemap.xml"]) {
    const result = await request.get(path);
    expect(result.ok()).toBe(true);
    expect(result.headers()["content-security-policy"]).toContain("object-src 'none'");
  }
});

test("CSP permits authenticated navigation, realtime and uploaded media on the production build", async ({ browser }) => {
  const actor = await registerVerifiedActor(browser, "csp-browser");
  try {
    expect((await rawApi(actor.context, "POST", "/auth/logout")).status()).toBe(204);
    const page = await actor.context.newPage();
    const violations: string[] = [];
    const runtimeErrors: string[] = [];
    let connectedFrames = 0;
    await page.exposeFunction("recordSecurityViolation", (directive: string) => violations.push(directive));
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        void (window as unknown as { recordSecurityViolation: (directive: string) => Promise<void> })
          .recordSecurityViolation(event.violatedDirective);
      });
    });
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      if (/hydration|hydrating|did not match|server rendered HTML/i.test(message.text())) {
        runtimeErrors.push(message.text());
      }
      if (/violates.*Content Security Policy|Refused to.*Content Security Policy/i.test(message.text())) {
        violations.push(message.text());
      }
    });
    page.on("websocket", (socket) => {
      if (!new URL(socket.url()).pathname.endsWith("/ws")) return;
      socket.on("framereceived", ({ payload }) => {
        if (typeof payload !== "string") return;
        try { if (JSON.parse(payload).type === "connected") connectedFrames += 1; } catch { /* Not an application JSON frame. */ }
      });
    });

    const loginPage = await page.goto("/en/login");
    expect(loginPage?.headers()["content-security-policy"]).toContain("connect-src 'self'");
    await page.getByPlaceholder("Email").fill(actor.email);
    await page.getByPlaceholder("Password", { exact: true }).fill(actor.password);
    const login = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/auth/login" && response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Login", exact: true }).click();
    expect((await login).status()).toBe(200);
    await expect.poll(() => connectedFrames).toBeGreaterThan(0);

    const profileRead = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/users/me" && response.request().method() === "GET"
    );
    await page.goto("/en/settings");
    const profileResponse = await profileRead;
    expect(profileResponse.status()).toBe(200);
    expect((await profileResponse.json()).user.id).toBe(actor.user.id);
    await expect(page.getByLabel("Display name", { exact: true })).toHaveValue(actor.user.displayName);

    // A locally generated PNG exercises the real browser upload and decoder using
    // only the isolated avatar storage fixture.
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 32;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#2563eb";
      context.fillRect(0, 0, 32, 32);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    const uploaded = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/storage/upload" && response.request().method() === "POST"
    );
    await page.locator('input[type="file"]').setInputFiles({
      name: "csp-avatar.png", mimeType: "image/png", buffer: Buffer.from(png, "base64")
    });
    const uploadResponse = await uploaded;
    expect(uploadResponse.status()).toBe(201);
    const { upload } = await uploadResponse.json() as { upload: { id: string; url: string } };
    const saved = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/users/me" && response.request().method() === "PATCH"
    );
    await page.getByRole("button", { name: "Save profile", exact: true }).click();
    const savedResponse = await saved;
    expect(savedResponse.status()).toBe(200);
    const { user: savedUser } = await savedResponse.json() as { user: { avatarUrl: string } };
    // Uploads are private previews until attachment. Assert the persisted public
    // avatar, not the now-obsolete upload preview URL.
    expect(savedUser.avatarUrl).toContain(upload.id);
    expect(savedUser.avatarUrl).not.toBe(upload.url);
    const image = page.locator("img").filter({ visible: true });
    await expect.poll(() => image.evaluateAll((images, url) =>
      images.some((element) => element.getAttribute("src") === url &&
        (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0), savedUser.avatarUrl)
    ).toBe(true);
    const media = await actor.context.request.get(new URL(savedUser.avatarUrl, page.url()).href);
    expect(media.status()).toBe(200);
    expect(media.headers()["content-type"]).toContain("image/");

    await page.goto("/en/messages");
    await expect(page).toHaveURL(/\/en\/messages$/);
    await expect(page.getByPlaceholder("Email", { exact: true })).toHaveCount(0);
    expect(violations).toEqual([]);
    expect(runtimeErrors).toEqual([]);
  } finally {
    await actor.context.close();
  }
});
