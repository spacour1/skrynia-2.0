import { expect, test } from "@playwright/test";
import {
  closeActors,
  createProduct,
  registerVerifiedActor
} from "./helpers.js";

test("temporary failures preserve auth, retry data, and navigation/draft affordances", async ({
  browser
}) => {
  const seller = await registerVerifiedActor(browser, "reliability-seller");
  const viewer = await registerVerifiedActor(browser, "reliability-viewer");

  try {
    const product = await createProduct(seller, "reliability");
    const page = await viewer.context.newPage();
    await page.addInitScript((cachedUser) => {
      window.localStorage.setItem("auth_cached_user", JSON.stringify(cachedUser));
    }, viewer.user);

    let authFailures = 0;
    await page.route("**/api/auth/me", async (route) => {
      if (authFailures++ === 0) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: { message: "temporary e2e failure" } })
        });
        return;
      }
      await route.continue();
    });
    await page.goto("/en/dashboard");
    await expect(
      page.getByRole("heading", { name: "Log in required", exact: true })
    ).toBeVisible();
    await expect(
      page.getByText(viewer.user.displayName, { exact: true })
    ).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => Boolean(window.localStorage.getItem("auth_cached_user")))
      )
      .toBe(true);
    await page.unroute("**/api/auth/me");
    await page.reload();
    await expect(page.getByText(viewer.user.displayName, { exact: true }).first()).toBeVisible();

    let catalogFailures = 0;
    await page.route("**/api/marketplace/products?**", async (route) => {
      // React Query performs the initial request plus three automatic retries. Fail all
      // four so the real QueryErrorState becomes visible; its explicit Retry action is
      // the next request and is allowed through.
      if (catalogFailures++ < 4) {
        await route.abort("failed");
        return;
      }
      await route.continue();
    });
    await page.goto(`/en/marketplace?q=${encodeURIComponent(product.title)}`);
    const errorState = page.getByRole("alert");
    await expect(errorState).toBeVisible();
    await errorState.getByRole("button", { name: "Try again" }).click();
    const productLink = page.getByRole("link", { name: product.title });
    await expect(productLink).toBeVisible();

    const newTabPromise = viewer.context.waitForEvent("page");
    await productLink.click({ modifiers: ["Control"] });
    const productTab = await newTabPromise;
    await productTab.waitForLoadState("domcontentloaded");
    await expect(productTab.getByRole("heading", { name: product.title })).toBeVisible();
    await productTab.close();

    await page.goto("/en");
    const categoryLink = page.locator('a[href*="/marketplace?category="]').first();
    await expect(categoryLink).toBeVisible();
    const categoryHref = await categoryLink.getAttribute("href");
    expect(categoryHref).toBeTruthy();
    const categoryUrl = new URL(categoryHref!, "http://frontend");
    expect(categoryUrl.searchParams.get("category")).toBeTruthy();

    const sellerPage = await seller.context.newPage();
    await sellerPage.goto("/en/seller/create");
    const titleInput = sellerPage.locator('input[maxlength="80"]').first();
    const draft = `Unsaved currency draft ${product.title}`;
    await titleInput.fill(draft);
    await sellerPage
      .locator("button")
      .filter({ hasText: seller.user.displayName })
      .click();
    await sellerPage.getByLabel("Display currency").selectOption("USD");
    await expect(titleInput).toHaveValue(draft);
  } finally {
    await closeActors(seller, viewer);
  }
});
