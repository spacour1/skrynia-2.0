import { expect, test } from "@playwright/test";
import {
  api,
  closeActors,
  createProductThroughUi,
  rawApi,
  registerVerifiedActorThroughUi,
  runId,
  waitForPageSocketFrame
} from "./helpers.js";

test("golden marketplace order flow is idempotent and acknowledges the first chat message", async ({
  browser
}) => {
  const seller = await registerVerifiedActorThroughUi(browser, "golden-seller");
  const buyer = await registerVerifiedActorThroughUi(browser, "golden-buyer");
  const anonymous = await browser.newContext();

  try {
    const product = await createProductThroughUi(seller, "golden");

    const publicPage = await anonymous.newPage();
    await publicPage.goto(`/en/products/${product.id}`);
    await expect(publicPage.getByRole("heading", { name: product.title })).toBeVisible();

    // Capture the socket on the same product document that exercises favorite,
    // conversation, and checkout controls.
    const buyerPage = await buyer.context.newPage();
    const socketConnected = waitForPageSocketFrame(
      buyerPage,
      (payload) => payload.includes('"type":"connected"')
    );
    await buyerPage.goto(`/en/products/${product.id}`);
    await socketConnected;

    const favoriteResponsePromise = buyerPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/marketplace/favorites/${product.id}` &&
        response.request().method() === "PUT"
    );
    await buyerPage
      .getByRole("button", { name: "Add to favorites", exact: true })
      .click();
    expect((await favoriteResponsePromise).status()).toBe(200);
    await expect(
      buyerPage.getByRole("button", {
        name: "Remove from favorites",
        exact: true
      })
    ).toBeVisible();
    const favoritesPage = await buyer.context.newPage();
    await favoritesPage.goto("/en/favorites");
    await expect(
      favoritesPage.getByRole("link", { name: product.title })
    ).toBeVisible();
    await favoritesPage.close();

    const messageBody = `First websocket message ${runId}`;
    const ack = waitForPageSocketFrame(
      buyerPage,
      (payload) =>
        payload.includes('"type":"message_ack"') &&
        payload.includes(messageBody)
    );
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

    const orderResponsePromise = buyerPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/orders" &&
        response.request().method() === "POST"
    );
    await buyerPage
      .getByRole("button", { name: "Buy securely", exact: true })
      .click();
    const orderResponse = await orderResponsePromise;
    expect(orderResponse.status()).toBe(201);
    const created = (await orderResponse.json()) as {
      order: { id: string; status: string };
    };
    const orderRequest = orderResponse.request();
    const key = orderRequest.headers()["idempotency-key"];
    expect(key, "the browser checkout must send an Idempotency-Key").toBeTruthy();
    const replayResponse = await rawApi(buyer.context, "POST", "/orders", {
      headers: { "Idempotency-Key": key },
      data: orderRequest.postDataJSON()
    });
    expect(replayResponse.status()).toBe(201);
    expect(replayResponse.headers()["idempotency-replayed"]).toBe("true");
    const replayed = (await replayResponse.json()) as {
      order: { id: string };
    };
    expect(replayed.order.id).toBe(created.order.id);

    await buyerPage.waitForURL(
      (url) => url.pathname.endsWith(`/orders/${created.order.id}`)
    );
    await buyerPage
      .getByRole("button", { name: "Success", exact: true })
      .click();
    await expect(buyerPage.getByText("paid", { exact: true })).toBeVisible();

    const sellerOrderPage = await seller.context.newPage();
    await sellerOrderPage.goto(`/en/orders/${created.order.id}`);
    await expect(sellerOrderPage.getByText("paid", { exact: true })).toBeVisible();
    await sellerOrderPage
      .getByRole("button", { name: "Start work", exact: true })
      .click();
    await expect(
      sellerOrderPage.getByText("in progress", { exact: true })
    ).toBeVisible();
    const deliveryNote = `Golden delivery ${runId}`;
    await sellerOrderPage
      .getByPlaceholder("Delivery details, credentials, or completion notes")
      .fill(deliveryNote);
    await sellerOrderPage
      .getByRole("button", { name: "Mark delivered", exact: true })
      .click();
    await expect(
      sellerOrderPage.getByText("delivered", { exact: true })
    ).toBeVisible();

    await buyerPage.reload();
    await expect(buyerPage.getByText(deliveryNote, { exact: true })).toBeVisible();
    await buyerPage
      .getByRole("button", {
        name: "Confirm delivery and release funds",
        exact: true
      })
      .click();
    await expect(
      buyerPage.getByText("completed", { exact: true })
    ).toBeVisible();

    const reviewInput = {
      data: { rating: 5, comment: `Golden review ${runId}` }
    };
    await buyerPage
      .getByPlaceholder("Review", { exact: true })
      .fill(reviewInput.data.comment);
    const reviewResponsePromise = buyerPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/orders/${created.order.id}/review` &&
        response.request().method() === "POST"
    );
    await buyerPage
      .getByRole("button", { name: "Submit review", exact: true })
      .click();
    const reviewResponse = await reviewResponsePromise;
    expect(reviewResponse.status()).toBe(201);
    const firstReview = (await reviewResponse.json()) as {
      review: { id: string };
    };
    const duplicateReviewResponse = await rawApi(
      buyer.context,
      "POST",
      `/orders/${created.order.id}/review`,
      reviewInput
    );
    expect(duplicateReviewResponse.status()).toBe(200);
    const duplicateReview = (await duplicateReviewResponse.json()) as {
      review: { id: string };
    };
    expect(duplicateReview.review.id).toBe(firstReview.review.id);
    await expect(
      buyerPage.getByText("completed", { exact: true })
    ).toBeVisible();
    await sellerOrderPage.close();
    const detail = await api<{ order: { status: string } }>(
      buyer.context,
      "GET",
      `/orders/${created.order.id}`
    );
    expect(detail.order.status).toBe("completed");
  } finally {
    await Promise.all([
      anonymous.close(),
      closeActors(seller, buyer)
    ]);
  }
});
