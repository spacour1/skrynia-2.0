import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createMessageReport, createUserReport } from "../src/modules/reports/reports.service.js";
import { sendMessage } from "../src/modules/chat/chat.service.js";
import { closeDb, createConversation, createUser, resetDb } from "./fixtures.js";

beforeEach(resetDb);
afterAll(closeDb);

describe("createUserReport", () => {
  it("rejects reporting yourself", async () => {
    const user = await createUser();
    await expect(createUserReport(user, { reportedUserId: user, reason: "spam" })).rejects.toThrow(
      "You cannot report yourself"
    );
  });

  it("rejects a duplicate pending report with the same reason", async () => {
    const reporter = await createUser();
    const target = await createUser();
    await createUserReport(reporter, { reportedUserId: target, reason: "fraud" });

    await expect(createUserReport(reporter, { reportedUserId: target, reason: "fraud" })).rejects.toMatchObject({
      code: "23505"
    });
  });

  it("allows reporting the same user again for a different reason", async () => {
    const reporter = await createUser();
    const target = await createUser();
    await createUserReport(reporter, { reportedUserId: target, reason: "fraud" });

    const second = await createUserReport(reporter, { reportedUserId: target, reason: "spam" });
    expect(second.reason).toBe("spam");
  });
});

describe("createMessageReport", () => {
  it("rejects reporting your own message", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const conversationId = await createConversation(buyer, seller);
    const message = await sendMessage({ conversationId, senderId: buyer, body: "Hi" });

    await expect(
      createMessageReport(buyer, "user", { messageId: message.id, reason: "spam" })
    ).rejects.toThrow("You cannot report your own message");
  });

  it("rejects a reporter who is not part of the conversation", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const outsider = await createUser();
    const conversationId = await createConversation(buyer, seller);
    const message = await sendMessage({ conversationId, senderId: buyer, body: "Hi" });

    await expect(createMessageReport(outsider, "user", { messageId: message.id, reason: "spam" })).rejects.toThrow();
  });

  it("marks scam/off_platform_deal/personal_data/prohibited_content reasons as high priority", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const conversationId = await createConversation(buyer, seller);
    const message = await sendMessage({ conversationId, senderId: buyer, body: "Hi" });

    const report = await createMessageReport(seller, "user", { messageId: message.id, reason: "scam" });
    expect(report.priority).toBe("high");
  });

  it("keeps a normal priority for low-severity reasons", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const conversationId = await createConversation(buyer, seller);
    const message = await sendMessage({ conversationId, senderId: buyer, body: "Hi" });

    const report = await createMessageReport(seller, "user", { messageId: message.id, reason: "insult" });
    expect(report.priority).toBe("normal");
  });
});
