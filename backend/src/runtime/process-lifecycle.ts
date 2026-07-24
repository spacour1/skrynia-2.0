export type ShutdownReason =
  | NodeJS.Signals
  | "unhandledRejection"
  | "uncaughtException"
  | "startupFailure";

type LifecycleLogger = {
  info(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
  fatal(fields: Record<string, unknown>, message: string): void;
};

export class ProcessLifecycleController {
  private shutdownPromise: Promise<void> | null = null;
  private hardTimer: NodeJS.Timeout | null = null;
  private forced = false;

  constructor(
    private readonly options: {
      hardTimeoutMs: number;
      markNotReady: () => void;
      shutdown: (reason: ShutdownReason) => Promise<void>;
      forceClose: () => void;
      forceExit: (code: number) => void;
      setExitCode: (code: number) => void;
      logger: LifecycleLogger;
    }
  ) {}

  request(reason: ShutdownReason, exitCode: number, forcedExitCode = exitCode) {
    if (this.shutdownPromise) {
      this.force(reason, forcedExitCode);
      return this.shutdownPromise;
    }

    try {
      this.options.markNotReady();
    } catch (error) {
      this.options.logger.error(
        { error, reason },
        "runtime_mark_not_ready_failed"
      );
    }
    this.options.logger.info({ reason }, "runtime_shutdown_started");
    this.hardTimer = setTimeout(() => {
      this.options.logger.fatal({ reason }, "runtime_shutdown_hard_timeout");
      this.force(reason, forcedExitCode || 1);
    }, this.options.hardTimeoutMs);

    this.shutdownPromise = this.options
      .shutdown(reason)
      .then(() => {
        if (this.hardTimer) clearTimeout(this.hardTimer);
        this.hardTimer = null;
        if (this.forced) return;
        this.options.setExitCode(exitCode);
        this.options.logger.info({ reason }, "runtime_shutdown_completed");
      })
      .catch((error) => {
        if (this.forced) return;
        this.options.logger.fatal({ error, reason }, "runtime_shutdown_failed");
        this.force(reason, 1);
      });
    return this.shutdownPromise;
  }

  private force(reason: ShutdownReason, exitCode: number) {
    if (this.forced) return;
    this.forced = true;
    if (this.hardTimer) clearTimeout(this.hardTimer);
    this.hardTimer = null;
    try {
      this.options.forceClose();
    } catch (error) {
      this.options.logger.error({ error, reason }, "runtime_force_close_failed");
    }
    this.options.forceExit(exitCode || 1);
  }
}

export function installProcessLifecycle(options: {
  hardTimeoutMs: number;
  markNotReady: () => void;
  shutdown: (reason: ShutdownReason) => Promise<void>;
  forceClose: () => void;
  logger: LifecycleLogger;
}) {
  const controller = new ProcessLifecycleController({
    ...options,
    forceExit: (code) => process.exit(code),
    setExitCode: (code) => {
      const current =
        typeof process.exitCode === "number" ? process.exitCode : 0;
      process.exitCode = Math.max(current, code);
    }
  });

  const onSignal = (signal: NodeJS.Signals) => {
    const forcedCode = signal === "SIGINT" ? 130 : 143;
    void controller.request(signal, 0, forcedCode);
  };
  const onUnhandledRejection = (error: unknown) => {
    options.logger.fatal({ error }, "runtime_unhandled_rejection");
    void controller.request("unhandledRejection", 1, 1);
  };
  const onUncaughtException = (error: Error) => {
    options.logger.fatal({ error }, "runtime_uncaught_exception");
    void controller.request("uncaughtException", 1, 1);
  };

  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  process.on("unhandledRejection", onUnhandledRejection);
  process.on("uncaughtException", onUncaughtException);

  return {
    controller,
    dispose() {
      process.off("SIGTERM", onSignal);
      process.off("SIGINT", onSignal);
      process.off("unhandledRejection", onUnhandledRejection);
      process.off("uncaughtException", onUncaughtException);
    }
  };
}
