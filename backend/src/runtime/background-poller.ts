export class BackgroundPoller {
  private timer: NodeJS.Timeout | null = null;
  private currentRun: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly options: {
      intervalMs: number;
      task: (shouldStop: () => boolean) => Promise<void>;
      onError?: (error: unknown) => void;
    }
  ) {}

  start(): Promise<void> {
    if (this.timer || this.currentRun) return Promise.resolve();
    this.stopping = false;
    // The first iteration deliberately runs in the background. Waiting for it here
    // turns a large (or continuously replenished) backlog into an unbounded process
    // startup: signal handlers and readiness publication would never be installed.
    void this.trigger();
    if (this.stopping) return Promise.resolve();
    this.timer = setInterval(() => void this.trigger(), this.options.intervalMs);
    // This timer intentionally remains referenced. A standalone polling process must
    // not exit merely because its latest batch happened to be empty.
    return Promise.resolve();
  }

  trigger(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (this.currentRun) return this.currentRun;
    this.currentRun = this.options
      .task(() => this.stopping)
      .catch((error) => this.options.onError?.(error))
      .finally(() => {
        this.currentRun = null;
      });
    return this.currentRun;
  }

  async stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.currentRun;
  }

  isStopping() {
    return this.stopping;
  }
}
