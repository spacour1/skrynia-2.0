import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config/env.js";
import {
  createTelegramConnectToken,
  consumeTelegramConnectToken,
  disconnectTelegram,
  getTelegramChatId
} from "../src/modules/users/telegram-link.service.js";
import { getNotificationPreferences, updateNotificationPreferences } from "../src/modules/notifications/preferences.service.js";
import { createNotification } from "../src/modules/notifications/notifications.service.js";
import { processNotificationDelivery } from "../src/modules/jobs/queue.js";
import { defaultLocale } from "../src/i18n/config.js";
import { t } from "../src/i18n/t.js";
import { closeDb, createOrder, createProduct, createUser, resetDb } from "./fixtures.js";

beforeEach(async () => {
  await resetDb();
  env.TELEGRAM_BOT_TOKEN = "test-bot-token";
  env.TELEGRAM_BOT_USERNAME = "skrynia_test_bot";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(closeDb);

async function connectTelegram(userId: string, chatId: string) {
  const { token } = await createTelegramConnectToken(userId);
  const outcome = await consumeTelegramConnectToken(token, chatId);
  expect(outcome).toBe("connected");
}

function telegramCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes("api.telegram.org"));
}

describe("Telegram connect token lifecycle", () => {
  it("creates a token and a t.me deep link", async () => {
    const userId = await createUser();
    const { token, link } = await createTelegramConnectToken(userId);
    expect(token).toHaveLength(24);
    expect(link).toBe(`https://t.me/skrynia_test_bot?start=${token}`);
  });

  it("consuming a valid token links the chat and returns 'connected'", async () => {
    const userId = await createUser();
    await connectTelegram(userId, "111222");
    expect(await getTelegramChatId(userId)).toBe("111222");
  });

  it("an unknown token does not connect anything", async () => {
    const outcome = await consumeTelegramConnectToken("not-a-real-token", "999999");
    expect(outcome).toBe("invalid");
  });

  it("re-submitting an already-consumed token from the same chat reports already_connected", async () => {
    const userId = await createUser();
    const { token } = await createTelegramConnectToken(userId);
    await consumeTelegramConnectToken(token, "555555");

    // The token column is nulled out once consumed; resubmitting the same string a second
    // time (e.g. a stale bookmarked link) must not be silently ignored.
    const second = await consumeTelegramConnectToken(token, "555555");
    expect(second).toBe("already_connected");
  });

  it("disconnecting clears the linked chat id", async () => {
    const userId = await createUser();
    await connectTelegram(userId, "777888");
    await disconnectTelegram(userId);
    expect(await getTelegramChatId(userId)).toBeNull();
  });
});

describe("notification preferences", () => {
  it("default to both channels enabled", async () => {
    const userId = await createUser();
    expect(await getNotificationPreferences(userId)).toEqual({ emailEnabled: true, telegramEnabled: true });
  });

  it("persist an update", async () => {
    const userId = await createUser();
    const prefs = await updateNotificationPreferences(userId, { telegramEnabled: false });
    expect(prefs).toEqual({ emailEnabled: true, telegramEnabled: false });
  });
});

describe("processNotificationDelivery", () => {
  it("escapes user-generated content before sending over Telegram's HTML parse mode", async () => {
    const userId = await createUser();
    await connectTelegram(userId, "121212");
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();

    await processNotificationDelivery({
      userId,
      titleKey: "notifications.newMessage.title",
      bodyKey: "notifications.newMessage.body",
      params: { sender: "<script>alert(1)</script>", preview: "hi" },
      notificationType: "message"
    });

    const [, init] = telegramCalls(fetchMock)[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.text).not.toContain("<script>");
    expect(body.text).toContain("&lt;script&gt;");
  });

  it("skips Telegram delivery when the user disabled it in preferences", async () => {
    const userId = await createUser();
    await connectTelegram(userId, "232323");
    await updateNotificationPreferences(userId, { telegramEnabled: false });
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();

    await processNotificationDelivery({ userId, subject: "Test", body: "Test body" });

    expect(telegramCalls(fetchMock)).toHaveLength(0);
  });

  it("skips Telegram delivery silently when the user never connected Telegram", async () => {
    const userId = await createUser();
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();

    await processNotificationDelivery({ userId, subject: "Test", body: "Test body" });

    expect(telegramCalls(fetchMock)).toHaveLength(0);
  });

  it("does not throw when the Telegram API call fails", async () => {
    const userId = await createUser();
    await connectTelegram(userId, "343434");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" }));

    await expect(processNotificationDelivery({ userId, subject: "Test", body: "Test body" })).resolves.toBeUndefined();
  });

  it("appends an Order:/Status: line and an 'Open order' button when orderId is set", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    await connectTelegram(buyer, "454545");
    const productId = await createProduct(seller);
    const orderId = await createOrder(buyer, seller, productId, { status: "paid" });
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();

    await processNotificationDelivery({
      userId: buyer,
      titleKey: "notifications.orderPaidBuyer.title",
      bodyKey: "notifications.orderPaidBuyer.body",
      notificationType: "order_paid",
      orderId
    });

    const [, init] = telegramCalls(fetchMock)[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.text).toContain(`#${orderId.slice(0, 8)}`);
    expect(body.text).toContain("paid");
    expect(body.reply_markup.inline_keyboard[0][0].url).toContain(`/orders/${orderId}`);
  });
});

describe("createNotification", () => {
  it("creates a notification row for an order event", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller);
    const orderId = await createOrder(buyer, seller, productId, { status: "paid" });

    const notification = await createNotification({
      userId: seller,
      type: "order_paid",
      templateKey: "notifications.orderPaidSeller",
      orderId
    });

    expect(notification.type).toBe("order_paid");
    expect(notification.title).toBe(t(defaultLocale, "notifications.orderPaidSeller.title"));
    expect(notification.orderId).toBe(orderId);
  });
});
