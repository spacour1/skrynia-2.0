import { expect, test } from "@playwright/test";
import {
  api,
  baseURL,
  closeActors,
  defaultPassword,
  loginActor,
  rawApi,
  registerVerifiedActor,
  runId,
  waitForConnectedWebSocket
} from "./helpers.js";

test("password change rotates the current session and revokes HTTP, refresh, and WebSocket access elsewhere", async ({
  browser
}) => {
  const primary = await registerVerifiedActor(browser, "session-user");
  const secondary = await loginActor(browser, primary.email, primary.password);
  const oldCookies = await secondary.context.cookies(baseURL);
  const oldSession = await browser.newContext();
  await oldSession.addCookies(oldCookies);
  const newPassword = `NewPassword-${runId}!1`;

  try {
    const primaryPage = await primary.context.newPage();
    const secondaryPage = await secondary.context.newPage();
    const primarySocketReady = waitForConnectedWebSocket(primaryPage);
    const secondarySocketReady = waitForConnectedWebSocket(secondaryPage);
    await Promise.all([
      primaryPage.goto("/en/settings"),
      secondaryPage.goto("/en/dashboard")
    ]);
    await primarySocketReady;
    const secondarySocket = await secondarySocketReady;
    let secondarySocketClosed = false;
    secondarySocket.on("close", () => {
      secondarySocketClosed = true;
    });

    await primaryPage.getByPlaceholder("Current password").fill(defaultPassword);
    await primaryPage.getByPlaceholder("New password", { exact: true }).fill(newPassword);
    await primaryPage
      .getByPlaceholder("Repeat new password", { exact: true })
      .fill(newPassword);
    await primaryPage.getByRole("button", { name: "Change password" }).click();
    await expect(primaryPage.getByText("Password updated", { exact: true })).toBeVisible();

    const currentSession = await rawApi(primary.context, "GET", "/auth/me");
    expect(currentSession.status()).toBe(200);

    await expect
      .poll(async () => (await rawApi(secondary.context, "GET", "/auth/me")).status())
      .toBe(401);
    await expect.poll(() => secondarySocketClosed).toBe(true);

    const oldRefresh = await rawApi(oldSession, "POST", "/auth/refresh");
    expect(oldRefresh.status()).toBe(401);

    const oldPasswordContext = await browser.newContext();
    const oldPasswordLogin = await rawApi(
      oldPasswordContext,
      "POST",
      "/auth/login",
      { data: { email: primary.email, password: defaultPassword } }
    );
    expect(oldPasswordLogin.status()).toBe(400);
    await oldPasswordContext.close();

    const newPasswordContext = await browser.newContext();
    const newPasswordLogin = await rawApi(
      newPasswordContext,
      "POST",
      "/auth/login",
      { data: { email: primary.email, password: newPassword } }
    );
    expect(newPasswordLogin.status()).toBe(200);
    await newPasswordContext.close();

    const me = await api<{ user: { id: string } }>(
      primary.context,
      "GET",
      "/auth/me"
    );
    expect(me.user.id).toBe(primary.user.id);
  } finally {
    await Promise.all([oldSession.close(), closeActors(primary, secondary)]);
  }
});
