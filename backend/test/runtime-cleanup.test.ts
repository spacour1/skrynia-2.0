import { describe, expect, it, vi } from "vitest";
import { runCleanupSteps } from "../src/runtime/async.js";

describe("ordered runtime cleanup", () => {
  it("runs in order and still closes the pool after an earlier failure", async () => {
    const order: string[] = [];
    const closePool = vi.fn(() => {
      order.push("postgres");
    });

    await expect(
      runCleanupSteps([
        {
          name: "realtime",
          run: () => {
            order.push("realtime");
            throw new Error("subscriber close failed");
          }
        },
        {
          name: "redis",
          run: () => {
            order.push("redis");
          }
        },
        { name: "postgres", run: closePool }
      ])
    ).rejects.toBeInstanceOf(AggregateError);

    expect(order).toEqual(["realtime", "redis", "postgres"]);
    expect(closePool).toHaveBeenCalledTimes(1);
  });
});
