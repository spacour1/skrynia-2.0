import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertCanSendMessage,
  getGroupedUserConversations,
  getOrCreateDirectConversation,
  getOrCreateOrderConversation,
  getOrCreateProductConversation,
  getUserConversations,
  markConversationRead,
  sendMessage
} from "../src/modules/chat/chat.service.js";
import { blockUser, closeDb, createConversation, createOrder, createProduct, createUser, muteUser, resetDb } from "./fixtures.js";

beforeEach(resetDb);
afterAll(closeDb);

describe("sendMessage", () => {
  it("stores a message between an unblocked buyer and seller", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const conversationId = await createConversation(buyer, seller);

    const message = await sendMessage({ conversationId, senderId: buyer, body: "Hello!" });

    expect(message.conversationId).toBe(conversationId);
    expect(message.body).toBe("Hello!");
  });

  it("rejects sending once either side has blocked the other", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const conversationId = await createConversation(buyer, seller);
    await blockUser(seller, buyer);

    await expect(sendMessage({ conversationId, senderId: buyer, body: "Hello!" })).rejects.toMatchObject({
      code: "messaging_blocked"
    });
  });

  it("rejects an empty or oversized body", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const conversationId = await createConversation(buyer, seller);

    await expect(sendMessage({ conversationId, senderId: buyer, body: "   " })).rejects.toThrow("Invalid message");
    await expect(sendMessage({ conversationId, senderId: buyer, body: "x".repeat(3001) })).rejects.toThrow("Invalid message");
  });
});

describe("assertCanSendMessage", () => {
  it("throws messaging_blocked in either block direction", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const conversationId = await createConversation(buyer, seller);
    await blockUser(buyer, seller);

    await expect(assertCanSendMessage(conversationId, seller)).rejects.toMatchObject({ code: "messaging_blocked" });
  });

  it("throws user_muted for a sender currently muted by a moderator", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const conversationId = await createConversation(buyer, seller);
    await muteUser(buyer);

    await expect(assertCanSendMessage(conversationId, buyer)).rejects.toMatchObject({ code: "user_muted" });
    await expect(assertCanSendMessage(conversationId, seller)).resolves.toBeDefined();
  });
});

describe("getOrCreateProductConversation", () => {
  it("does not create a conversation when the pair is blocked", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller);
    await blockUser(seller, buyer);

    await expect(getOrCreateProductConversation({ buyerId: buyer, sellerId: seller, productId })).rejects.toMatchObject({
      code: "messaging_blocked"
    });

    const conversations = await getUserConversations(buyer, "user");
    expect(conversations).toHaveLength(0);
  });

  it("reuses the existing conversation for the same buyer/seller/product pair", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller);

    const first = await getOrCreateProductConversation({ buyerId: buyer, sellerId: seller, productId });
    const second = await getOrCreateProductConversation({ buyerId: buyer, sellerId: seller, productId });

    expect(first.existing).toBe(false);
    expect(second.existing).toBe(true);
    expect(second.id).toBe(first.id);
  });
});

describe("conversation contexts", () => {
  it("reuses one direct conversation for an unordered user pair", async () => {
    const firstUser = await createUser();
    const secondUser = await createUser();

    const first = await getOrCreateDirectConversation({ buyerId: firstUser, sellerId: secondUser });
    const second = await getOrCreateDirectConversation({ buyerId: secondUser, sellerId: firstUser });

    expect(first.existing).toBe(false);
    expect(second.existing).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it("keeps product and order conversations separate for the same listing", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller);
    const orderId = await createOrder(buyer, seller, productId);

    const productConversation = await getOrCreateProductConversation({ buyerId: buyer, sellerId: seller, productId });
    const orderConversation = await getOrCreateOrderConversation({ buyerId: buyer, sellerId: seller, productId, orderId });
    const sameOrderConversation = await getOrCreateOrderConversation({ buyerId: buyer, sellerId: seller, productId, orderId });

    expect(productConversation.id).not.toBe(orderConversation.id);
    expect(sameOrderConversation.existing).toBe(true);
    expect(sameOrderConversation.id).toBe(orderConversation.id);
  });

  it("groups direct, product, and order contexts under the peer user", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller);
    const orderId = await createOrder(buyer, seller, productId);

    const direct = await getOrCreateDirectConversation({ buyerId: buyer, sellerId: seller });
    const product = await getOrCreateProductConversation({ buyerId: buyer, sellerId: seller, productId });
    const order = await getOrCreateOrderConversation({ buyerId: buyer, sellerId: seller, productId, orderId });

    await sendMessage({ conversationId: direct.id, senderId: seller, body: "Direct hello" });
    await sendMessage({ conversationId: product.id, senderId: seller, body: "Product hello" });
    await sendMessage({ conversationId: order.id, senderId: seller, body: "Order hello" });

    const groups = await getGroupedUserConversations(buyer, "user");

    expect(groups).toHaveLength(1);
    expect(groups[0].peerUserId).toBe(seller);
    expect(groups[0].totalUnreadCount).toBe(3);
    expect(groups[0].contexts.map((context) => context.type).sort()).toEqual(["direct", "order", "product"]);
  });
});

describe("getUserConversations", () => {
  it("reports unreadCount for the recipient and clears it after markConversationRead", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const conversationId = await createConversation(buyer, seller);
    await sendMessage({ conversationId, senderId: buyer, body: "Ping" });

    const beforeRead = await getUserConversations(seller, "user");
    expect(beforeRead.find((c) => c.id === conversationId)?.unreadCount).toBe(1);

    await markConversationRead(conversationId, seller);

    const afterRead = await getUserConversations(seller, "user");
    expect(afterRead.find((c) => c.id === conversationId)?.unreadCount).toBe(0);
  });

  it("flags the conversation as blocked and not sendable once one side blocks the other", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const conversationId = await createConversation(buyer, seller);
    await blockUser(buyer, seller);

    const conversations = await getUserConversations(seller, "user");
    const conversation = conversations.find((c) => c.id === conversationId);
    expect(conversation?.blocked).toBe(true);
    expect(conversation?.canSendMessage).toBe(false);
  });
});
