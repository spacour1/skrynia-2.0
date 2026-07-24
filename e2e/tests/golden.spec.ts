import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  api,
  closeActors,
  createOrder,
  createProduct,
  registerVerifiedActor,
  runId,
  waitForPageSocketFrame
} from "./helpers.js";

test("golden marketplace order flow is idempotent and acknowledges the first chat message", async ({
  browser
}) => {
  const seller = await registerVerifiedActor(browser, "golden-seller");
  const buyer = await registerVerifiedActor(browser, "golden-buyer");
  const anonymous = await browser.newContext();

  try {
    const product = await createProduct(seller, "golden");

    const publicPage = await anonymous.newPage();
    await publicPage.goto(`/en/products/${product.id}`);
    await expect(publicPage.getByRole("heading", { name: product.title })).toBeVisible();

    await api(buyer.context, "PUT", `/marketplace/favorites/${product.id}`);
    const favoritesPage = await buyer.context.newPage();
    await favoritesPage.goto("/en/favorites");
    await expect(favoritesPage.getByRole("link", { name: product.title })).toBeVisible();
    await favoritesPage.close();

    // A fresh page guarantees that the captured socket belongs to this document,
    // rather than to the preceding hard navigation from Favorites.
    const buyerPage = await buyer.context.newPage();
    const socketConnected = waitForPageSocketFrame(
      buyerPage,
      (payload) => payload.includes('"type":"connected"')
    );
    const messageBody = `First websocket message ${runId}`;
    const ack = waitForPageSocketFrame(
      buyerPage,
      (payload) => payload.includes('"type":"message_ack"') && payload.includes(messageBody)
    );
    await buyerPage.goto(`/en/products/${product.id}`);
    await socketConnected;
    await buyerPage.getByPlaceholder("Write a message").fill(messageBody);
    await buyerPage.getByRole("button", { name: "Send message" }).click();
    const failedDelivery = buyerPage
      .getByText("Failed", { exact: true })
      .or(buyerPage.getByText("Realtime connection is not available", { exact: true }))
      .waitFor({ state: "visible", timeout: 20_000 })
      .then(() => ({ kind: "ui_failure" as const }));
    const ackOutcome = ack
      .then((payload) => ({ kind: "ack" as const, payload }))
      .catch((error: unknown) => ({
        kind: "socket_failure" as const,
        error: error instanceof Error ? error.message : String(error)
      }));
    const outcome = await Promise.race([ackOutcome, failedDelivery]);
    expect(outcome, "the first chat send must complete through message_ack").toMatchObject({
      kind: "ack"
    });
    await expect(buyerPage.getByText(messageBody, { exact: true })).toBeVisible();
    await expect(buyerPage.getByText("Sent", { exact: true })).toBeVisible();

    const key = randomUUID();
    const created = await createOrder(buyer, product.id, key);
    const replayed = await createOrder(buyer, product.id, key);
    expect(replayed.order.id).toBe(created.order.id);

    await api(buyer.context, "POST", `/payments/test/orders/${created.order.id}/success`);
    await api(seller.context, "POST", `/orders/${created.order.id}/start`);
    await api(seller.context, "POST", `/orders/${created.order.id}/deliver`, {
      data: { deliveryNote: `Golden delivery ${runId}` }
    });
    await api(buyer.context, "POST", `/orders/${created.order.id}/confirm`);

    await expect
      .poll(async () => {
        const detail = await api<{ order: { status: string } }>(
          buyer.context,
          "GET",
          `/orders/${created.order.id}`
        );
        return detail.order.status;
      })
      .toBe("completed");

    const reviewInput = {
      data: { rating: 5, comment: `Golden review ${runId}` }
    };
    const firstReview = await api<{ review: { id: string } }>(
      buyer.context,
      "POST",
      `/orders/${created.order.id}/review`,
      reviewInput
    );
    const duplicateReview = await api<{ review: { id: string } }>(
      buyer.context,
      "POST",
      `/orders/${created.order.id}/review`,
      reviewInput
    );
    expect(duplicateReview.review.id).toBe(firstReview.review.id);

    await buyerPage.goto(`/en/orders/${created.order.id}`);
    await expect(buyerPage.getByText("completed", { exact: true })).toBeVisible();
  } finally {
    await Promise.all([
      anonymous.close(),
      closeActors(seller, buyer)
    ]);
  }
});
