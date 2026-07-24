import { expect, test } from "@playwright/test";
import {
  api,
  closeActors,
  createProduct,
  loginAdmin,
  rawApi,
  registerVerifiedActor
} from "./helpers.js";

test("blocking and reactivating a listing invalidates public list and detail caches", async ({
  browser
}) => {
  const seller = await registerVerifiedActor(browser, "moderation-seller");
  const admin = await loginAdmin(browser);
  const anonymous = await browser.newContext();

  try {
    const product = await createProduct(seller, "moderation");
    const publicPage = await anonymous.newPage();
    await publicPage.goto(`/en/products/${product.id}`);
    await expect(publicPage.getByRole("heading", { name: product.title })).toBeVisible();

    const warmList = await api<{ products: Array<{ id: string }> }>(
      anonymous,
      "GET",
      `/marketplace/products?q=${encodeURIComponent(product.title)}`
    );
    expect(warmList.products.some((item) => item.id === product.id)).toBe(true);

    await api(admin.context, "PATCH", `/admin/listings/${product.id}`, {
      data: { status: "blocked" }
    });

    await expect
      .poll(async () => {
        const response = await rawApi(
          anonymous,
          "GET",
          `/marketplace/products/${product.id}`
        );
        return response.status();
      })
      .toBe(404);
    await expect
      .poll(async () => {
        const list = await api<{ products: Array<{ id: string }> }>(
          anonymous,
          "GET",
          `/marketplace/products?q=${encodeURIComponent(product.title)}`
        );
        return list.products.some((item) => item.id === product.id);
      })
      .toBe(false);

    const ownerPreview = await api<{ product: { id: string; status: string } }>(
      seller.context,
      "GET",
      `/marketplace/products/${product.id}`
    );
    expect(ownerPreview.product.status).toBe("blocked");
    const adminPreview = await api<{ product: { id: string } }>(
      admin.context,
      "GET",
      `/marketplace/products/${product.id}`
    );
    expect(adminPreview.product.id).toBe(product.id);

    const ownerPage = await seller.context.newPage();
    await ownerPage.goto(`/en/products/${product.id}`);
    await expect(ownerPage.getByRole("heading", { name: product.title })).toBeVisible();

    await api(admin.context, "PATCH", `/admin/listings/${product.id}`, {
      data: { status: "active" }
    });
    await expect
      .poll(async () => {
        const response = await rawApi(
          anonymous,
          "GET",
          `/marketplace/products/${product.id}`
        );
        return response.status();
      })
      .toBe(200);
    await expect
      .poll(async () => {
        const list = await api<{ products: Array<{ id: string }> }>(
          anonymous,
          "GET",
          `/marketplace/products?q=${encodeURIComponent(product.title)}`
        );
        return list.products.some((item) => item.id === product.id);
      })
      .toBe(true);

    await publicPage.reload();
    await expect(publicPage.getByRole("heading", { name: product.title })).toBeVisible();
  } finally {
    await Promise.all([anonymous.close(), closeActors(seller, admin)]);
  }
});
