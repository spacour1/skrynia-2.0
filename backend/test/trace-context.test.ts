import { describe, expect, it } from "vitest";
import { currentTraceId, runWithTraceId } from "../src/common/trace-context.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("trace context", () => {
  it("keeps concurrent request traces isolated across async boundaries", async () => {
    const firstMayContinue = deferred();
    const secondHasStarted = deferred();
    const observations: string[] = [];

    await Promise.all([
      runWithTraceId("trace-first", async () => {
        observations.push(currentTraceId() ?? "missing");
        secondHasStarted.resolve();
        await firstMayContinue.promise;
        await Promise.resolve();
        observations.push(currentTraceId() ?? "missing");
      }),
      runWithTraceId("trace-second", async () => {
        await secondHasStarted.promise;
        observations.push(currentTraceId() ?? "missing");
        firstMayContinue.resolve();
        await Promise.resolve();
        observations.push(currentTraceId() ?? "missing");
      })
    ]);

    expect(observations.filter((value) => value === "trace-first")).toHaveLength(2);
    expect(observations.filter((value) => value === "trace-second")).toHaveLength(2);
    expect(currentTraceId()).toBeUndefined();
  });
});
