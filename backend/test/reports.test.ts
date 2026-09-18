import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { getRedis } from "../src/common/redis.js";
import { pool } from "../src/db/pool.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import { createMessageReport, createUserReport } from "../src/modules/reports/reports.service.js";
import { sendMessage } from "../src/modules/chat/chat.service.js";
import { onRealtimeEvent } from "../src/modules/realtime/realtime-runtime.js";
import { closeDb, createConversation, createUser, resetDb } from "./fixtures.js";

const app = createApp();

beforeEach(resetDb);
afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

async function authedClient(userId: string, role: "user" | "moderator") {
  const session = await issueSession(userId, role);
  const cookie = [`access_token=${session.accessToken}`, `csrf_token=${session.csrfToken}`];
  return {
    get: (path: string) => request(app).get(path).set("Cookie", cookie),
    post: (path: string) => request(app).post(path).set("Cookie", cookie).set("X-CSRF-Token", session.csrfToken)
  };
}

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

describe("message moderation visibility", () => {
  it("commits hide/restore with a durable event and broadcasts the same stable event immediately", async () => {
    const buyer = await createUser();
    const seller = await createUser();
    const moderatorId = await createUser("moderator");
    const conversationId = await createConversation(buyer, seller);
    const message = await sendMessage({ conversationId, senderId: buyer, body: "Sensitive content" });
    const moderator = await authedClient(moderatorId, "moderator");
    const sellerClient = await authedClient(seller, "user");
    const received: Array<{ id: string; payload: unknown }> = [];
    const unsubscribe = onRealtimeEvent(async (event) => {
      if (event.type === "message.moderated" && event.targetId === conversationId) {
        received.push({ id: event.id, payload: event.payload });
      }
    });

    try {
      const hidden = await moderator.post(`/admin/messages/${message.id}/hide`);
      expect(hidden.status).toBe(200);
      const hiddenEvent = await pool.query<{
        id: string;
        payload: { messageId: string; conversationId: string; hidden: boolean };
        status: string;
      }>(
        `select id, payload, status
         from domain_outbox
         where event_type = 'message.moderated' and aggregate_id = $1
         order by created_at desc, id desc
         limit 1`,
        [message.id]
      );
      expect(hiddenEvent.rows[0]).toMatchObject({
        payload: { messageId: message.id, conversationId, hidden: true },
        status: "pending"
      });
      expect(received).toContainEqual({
        id: hiddenEvent.rows[0].id,
        payload: {
          type: "message.moderated",
          messageId: message.id,
          conversationId,
          hidden: true
        }
      });
      const hiddenPage = await sellerClient.get(`/chat/conversations/${conversationId}/messages`);
      expect(hiddenPage.body.messages.find((row: { id: string }) => row.id === message.id)).toMatchObject({
        hidden: true
      });

      const restored = await moderator.post(`/admin/messages/${message.id}/restore`);
      expect(restored.status).toBe(200);
      const restoredEvent = await pool.query<{
        id: string;
        payload: { messageId: string; conversationId: string; hidden: boolean };
      }>(
        `select id, payload
         from domain_outbox
         where event_type = 'message.moderated' and aggregate_id = $1
         order by created_at desc, id desc
         limit 1`,
        [message.id]
      );
      expect(restoredEvent.rows[0].payload).toEqual({
        messageId: message.id,
        conversationId,
        hidden: false
      });
      expect(received).toContainEqual({
        id: restoredEvent.rows[0].id,
        payload: {
          type: "message.moderated",
          messageId: message.id,
          conversationId,
          hidden: false
        }
      });
    } finally {
      unsubscribe();
    }
  });
});
