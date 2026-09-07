import { expect, test, type Page } from "@playwright/test";
import {
  api,
  closeActors,
  rawApi,
  registerVerifiedActor
} from "./helpers.js";

type ReplicaName = "primary" | "replica";

async function connectReplicaSocket(
  page: Page,
  name: ReplicaName,
  endpoint: string,
  ticket: string
) {
  await page.evaluate(
    ({ socketName, socketEndpoint, oneTimeTicket }) =>
      new Promise<void>((resolve, reject) => {
        type SocketState = {
          socket: WebSocket;
          connected: boolean;
          closed: boolean;
          closeCode: number | null;
          closeReason: string;
        };
        type Stage6Window = Window & {
          __stage6ReplicaSockets?: Partial<Record<ReplicaName, SocketState>>;
        };

        const holder = window as Stage6Window;
        const sockets = (holder.__stage6ReplicaSockets ??= {});
        const socketUrl = new URL(socketEndpoint);
        socketUrl.searchParams.set("ticket", oneTimeTicket);
        const socket = new WebSocket(socketUrl.toString());
        const state: SocketState = {
          socket,
          connected: false,
          closed: false,
          closeCode: null,
          closeReason: ""
        };
        sockets[socketName] = state;

        const timer = window.setTimeout(() => {
          reject(new Error(`Timed out connecting the ${socketName} API replica`));
        }, 20_000);
        socket.addEventListener("message", (event) => {
          if (typeof event.data !== "string") return;
          try {
            const frame = JSON.parse(event.data) as { type?: string };
            if (frame.type !== "connected" || state.connected) return;
            state.connected = true;
            window.clearTimeout(timer);
            resolve();
          } catch {
            // Ignore unrelated non-JSON frames; the server's connected frame is JSON.
          }
        });
        socket.addEventListener("close", (event) => {
          state.closed = true;
          state.closeCode = event.code;
          state.closeReason = event.reason;
          if (!state.connected) {
            window.clearTimeout(timer);
            reject(
              new Error(
                `${socketName} API replica closed before connect (${event.code})`
              )
            );
          }
        });
        socket.addEventListener("error", () => {
          if (!state.connected) {
            window.clearTimeout(timer);
            reject(new Error(`${socketName} API replica WebSocket failed`));
          }
        });
      }),
    {
      socketName: name,
      socketEndpoint: endpoint,
      oneTimeTicket: ticket
    }
  );
}

async function replicaSocketState(page: Page, name: ReplicaName) {
  return page.evaluate((socketName) => {
    type Stage6Window = Window & {
      __stage6ReplicaSockets?: Partial<
        Record<
          ReplicaName,
          {
            connected: boolean;
            closed: boolean;
            closeCode: number | null;
            closeReason: string;
          }
        >
      >;
    };
    const state = (window as Stage6Window).__stage6ReplicaSockets?.[socketName];
    return state
      ? {
          connected: state.connected,
          closed: state.closed,
          closeCode: state.closeCode,
          closeReason: state.closeReason
        }
      : null;
  }, name);
}

test("all-session revocation closes sockets on both API replicas", async ({
  browser
}) => {
  const actor = await registerVerifiedActor(browser, "replica-revocation");
  const primaryEndpoint =
    process.env.E2E_PRIMARY_WS_URL ?? "ws://api:4000/ws";
  const replicaEndpoint =
    process.env.E2E_REPLICA_WS_URL ?? "ws://api-replica:4000/ws";

  try {
    const page = await actor.context.newPage();
    await page.goto("/en/dashboard");

    const primaryTicket = await api<{ ticket: string }>(
      actor.context,
      "POST",
      "/auth/ws-ticket"
    );
    const replicaTicket = await api<{ ticket: string }>(
      actor.context,
      "POST",
      "/auth/ws-ticket"
    );

    await Promise.all([
      connectReplicaSocket(page, "primary", primaryEndpoint, primaryTicket.ticket),
      connectReplicaSocket(page, "replica", replicaEndpoint, replicaTicket.ticket)
    ]);
    await expect.poll(() => replicaSocketState(page, "primary")).toMatchObject({
      connected: true,
      closed: false
    });
    await expect.poll(() => replicaSocketState(page, "replica")).toMatchObject({
      connected: true,
      closed: false
    });

    const revoked = await rawApi(actor.context, "POST", "/auth/logout-all");
    expect(revoked.status()).toBe(204);

    await expect.poll(() => replicaSocketState(page, "primary")).toMatchObject({
      closed: true,
      closeCode: 4001,
      closeReason: "Sessions revoked"
    });
    await expect.poll(() => replicaSocketState(page, "replica")).toMatchObject({
      closed: true,
      closeCode: 4001,
      closeReason: "Sessions revoked"
    });
  } finally {
    await closeActors(actor);
  }
});
