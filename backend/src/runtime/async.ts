export class RuntimeTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeTimeoutError";
  }
}

export async function settleWithin(
  promise: Promise<unknown>,
  timeoutMs: number
): Promise<boolean> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => false
      ),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = `Operation exceeded ${timeoutMs}ms`
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new RuntimeTimeoutError(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function runCleanupSteps(
  steps: Array<{ name: string; run: () => Promise<unknown> | unknown }>
) {
  const failures: Error[] = [];
  for (const step of steps) {
    try {
      await step.run();
    } catch (error) {
      failures.push(
        new Error(`Runtime cleanup step failed: ${step.name}`, {
          cause: error
        })
      );
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "One or more runtime cleanup steps failed");
  }
}
