import { expect, test } from "@playwright/test";
import {
  api,
  closeActors,
  createPaidDeliveredOrder,
  createProduct,
  loginAdmin,
  rawApi,
  registerVerifiedActor,
  runId
} from "./helpers.js";

test("participants discuss a dispute in UI and an admin sees and resolves that thread", async ({
  browser
}) => {
  const seller = await registerVerifiedActor(browser, "dispute-seller");
  const buyer = await registerVerifiedActor(browser, "dispute-buyer");
  const admin = await loginAdmin(browser);

  try {
    const product = await createProduct(seller, "dispute");
    const created = await createPaidDeliveredOrder(buyer, seller, product.id);
    const originalReason = `Immutable dispute reason ${runId}`;
    const sellerReply = `Seller evidence response ${runId}`;

    const buyerPage = await buyer.context.newPage();
    await buyerPage.goto(`/en/orders/${created.order.id}`);
    await buyerPage.getByPlaceholder("Open dispute reason").fill(originalReason);
    await buyerPage.getByRole("button", { name: "Open dispute" }).click();
    const participantThread = buyerPage.getByTestId("participant-dispute-thread");
    await expect(participantThread).toBeVisible();
    await expect(buyerPage.getByTestId("original-dispute-reason")).toHaveText(originalReason);

    const participantDetail = await api<{
      dispute: { id: string; reason: string; status: string };
    }>(buyer.context, "GET", `/disputes/orders/${created.order.id}/dispute`);
    expect(participantDetail.dispute.reason).toBe(originalReason);

    const sellerPage = await seller.context.newPage();
    await sellerPage.goto(`/en/orders/${created.order.id}`);
    await expect(sellerPage.getByTestId("original-dispute-reason")).toHaveText(originalReason);
    await sellerPage
      .getByPlaceholder("Describe the facts relevant to this dispute")
      .fill(sellerReply);
    await sellerPage.getByRole("button", { name: "Send reply" }).click();
    await expect(sellerPage.getByText(sellerReply, { exact: true })).toBeVisible();

    const adminPage = await admin.context.newPage();
    await adminPage.goto(`/en/admin/disputes/${participantDetail.dispute.id}`);
    await expect(adminPage.getByTestId("admin-original-dispute-reason")).toHaveText(
      originalReason
    );
    await expect(
      adminPage.getByTestId("admin-dispute-messages").getByText(sellerReply, { exact: true })
    ).toBeVisible();

    await adminPage.getByPlaceholder("Admin note").fill(`Refund decision ${runId}`);
    await adminPage.getByRole("button", { name: "Refund buyer" }).click();
    await expect
      .poll(async () => {
        const detail = await api<{
          dispute: { status: string };
        }>(admin.context, "GET", `/disputes/${participantDetail.dispute.id}`);
        return detail.dispute.status;
      })
      .toBe("resolved");

    const repeated = await api<{ idempotent: boolean }>(
      admin.context,
      "POST",
      `/disputes/${participantDetail.dispute.id}/resolve`,
      {
        data: {
          decision: "refund",
          adminNote: `Refund decision ${runId}`
        }
      }
    );
    expect(repeated.idempotent).toBe(true);

    const order = await api<{ order: { status: string } }>(
      buyer.context,
      "GET",
      `/orders/${created.order.id}`
    );
    expect(order.order.status).toBe("refunded");

    const forbiddenMessage = await rawApi(
      seller.context,
      "POST",
      `/disputes/${participantDetail.dispute.id}/messages`,
      { data: { body: `Too late ${runId}` } }
    );
    expect(forbiddenMessage.status()).toBe(400);

    const afterResolution = await api<{
      dispute: { reason: string; status: string };
    }>(buyer.context, "GET", `/disputes/orders/${created.order.id}/dispute`);
    expect(afterResolution.dispute.reason).toBe(originalReason);
    expect(afterResolution.dispute.status).toBe("resolved");

    await buyerPage.reload();
    await expect(buyerPage.getByTestId("original-dispute-reason")).toHaveText(originalReason);
    await expect(
      buyerPage.getByTestId("participant-dispute-thread").getByText("Resolved", {
        exact: true
      })
    ).toBeVisible();
    await expect(
      buyerPage.getByPlaceholder("Describe the facts relevant to this dispute")
    ).toHaveCount(0);
  } finally {
    await closeActors(seller, buyer, admin);
  }
});
