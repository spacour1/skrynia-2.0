import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertCanSendMessage,
  getOrCreateProductConversation,
  getUserConversations,
  markConversationRead,
  sendMessage
} from "../src/modules/chat/chat.service.js";
import { blockUser, closeDb, createConversation, createProduct, createUser, muteUser, resetDb } from "./fixtures.js";

beforeEach(resetDb);
afterAll(closeDb);

describe("sendMessage", () => {
  it("stores a message between an unblocked buyer and seller", async () => {
    const seller = await createUser("seller");
    const buyer = await createUser();
    const conversationId = await createConversation(buyer, seller);

    const message = await sendMessage({ conversationId, senderId: buyer, body: "Hello!" });

    expect(message.conversationId).toBe(conversationId);
    expect(message.body).toBe("Hello!");
  });

  it("rejects sending once either side has blocked the other", async () => {
    const seller = await createUser("seller");
    const buyer = await createUser();
    const conversationId = await createConversation(buyer, seller);
    await blockUser(seller, buyer);

    await expect(sendMessage({ conversationId, senderId: buyer, body: "Hello!" })).rejects.toMatchObject({
      code: "messaging_blocked"
    });
  });

  it("rejects an empty or oversized body", async () => {
    const seller = await createUser("seller");
    const buyer = await createUser();
    const conversationId = await createConversation(buyer, seller);

    await expect(sendMessage({ conversationId, senderId: buyer, body: "   " })).rejects.toThrow("Invalid message");
    await expect(sendMessage({ conversationId, senderId: buyer, body: "x".repeat(3001) })).rejects.toThrow("Invalid message");
  });
});

describe("assertCanSendMessage", () => {
  it("throws messaging_blocked in either block direction", async () => {
    const seller = await createUser("seller");
    const buyer = await createUser();
    const conversationId = await createConversation(buyer, seller);
    await blockUser(buyer, seller);

    await expect(assertCanSendMessage(conversationId, seller)).rejects.toMatchObject({ code: "messaging_blocked" });
  });

  it("throws user_muted for a sender currently muted by a moderator", async () => {
    const seller = await createUser("seller");
    const buyer = await createUser();
    const conversationId = await createConversation(buyer, seller);
    await muteUser(buyer);

    await expect(assertCanSendMessage(conversationId, buyer)).rejects.toMatchObject({ code: "user_muted" });
    await expect(assertCanSendMessage(conversationId, seller)).resolves.toBeDefined();
  });
});

describe("getOrCreateProductConversation", () => {
  it("does not create a conversation when the pair is blocked", async () => {
    const seller = await createUser("seller");
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
    const seller = await createUser("seller");
    const buyer = await createUser();
    const productId = await createProduct(seller);

    const first = await getOrCreateProductConversation({ buyerId: buyer, sellerId: seller, productId });
    const second = await getOrCreateProductConversation({ buyerId: buyer, sellerId: seller, productId });

    expect(first.existing).toBe(false);
    expect(second.existing).toBe(true);
    expect(second.id).toBe(first.id);
  });
});

describe("getUserConversations", () => {
  it("reports unreadCount for the recipient and clears it after markConversationRead", async () => {
    const seller = await createUser("seller");
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
    const seller = await createUser("seller");
    const buyer = await createUser();
    const conversationId = await createConversation(buyer, seller);
    await blockUser(buyer, seller);

    const conversations = await getUserConversations(seller, "user");
    const conversation = conversations.find((c) => c.id === conversationId);
    expect(conversation?.blocked).toBe(true);
    expect(conversation?.canSendMessage).toBe(false);
  });
});
