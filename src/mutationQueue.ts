import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** Maximum time a queued mutation waits for its turn before failing. */
export const MAX_QUEUE_WAIT_MS = 30_000;

/** Default time `drain` waits for in-flight mutations during shutdown. */
export const DEFAULT_DRAIN_TIMEOUT_MS = 10_000;

type Waiter = {
  label: string;
  grant: () => void;
  timer: NodeJS.Timeout;
};

type ToolConfig = {
  annotations?: {
    readOnlyHint?: boolean;
  };
};

type ToolHandler = (...args: unknown[]) => unknown;

type LooseRegistrar = (name: string, config: ToolConfig, handler: unknown) => unknown;

const EXCLUSIVE_MUTATION_MARKER = Symbol("mutationQueue.exclusiveMutation");

/**
 * Serializes Discord mutations. MCP clients can issue overlapping tool calls
 * (and some clients pipeline requests), but restore plans assume they observe a
 * stable guild state. Running mutations one at a time keeps that assumption
 * true and makes "one mutation in flight" a meaningful shutdown signal.
 */
export class MutationQueue {
  private running = false;
  private waiters: Waiter[] = [];
  private idleListeners = new Set<() => void>();

  isBusy(): boolean {
    return this.running || this.waiters.length > 0;
  }

  /** Number of mutations that are running or waiting for their turn. */
  depth(): number {
    return (this.running ? 1 : 0) + this.waiters.length;
  }

  async run<T>(label: string, fn: () => T | Promise<T>): Promise<Awaited<T>> {
    await this.acquire(label);
    try {
      return (await fn()) as Awaited<T>;
    } finally {
      this.release();
    }
  }

  /**
   * Runs an operation only when no other mutation is running or queued.
   * Restore apply uses this so it can never interleave with another mutation;
   * the caller gets an immediate rejection instead of waiting in line.
   */
  async runExclusive<T>(label: string, fn: () => T | Promise<T>): Promise<Awaited<T>> {
    if (this.isBusy()) {
      throw new Error(
        `Mutation queue is busy: exclusive operation "${label}" rejected immediately. ` +
          `Another mutation is in flight or queued; retry when the queue is idle.`,
      );
    }

    this.running = true;
    try {
      return (await fn()) as Awaited<T>;
    } finally {
      this.release();
    }
  }

  /**
   * Resolves true when the queue becomes idle within `timeoutMs`, false when
   * the timeout expires first (a mutation is still in flight).
   */
  async drain(timeoutMs = DEFAULT_DRAIN_TIMEOUT_MS): Promise<boolean> {
    if (!this.isBusy()) {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      const listener = (): void => {
        cleanup();
        resolve(true);
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, Math.max(1, timeoutMs));
      const cleanup = (): void => {
        clearTimeout(timer);
        this.idleListeners.delete(listener);
      };

      this.idleListeners.add(listener);
    });
  }

  private acquire(label: string): Promise<void> {
    if (!this.running && this.waiters.length === 0) {
      this.running = true;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        label,
        grant: resolve,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) {
            this.waiters.splice(index, 1);
          }
          reject(
            new Error(
              `Mutation queue timeout after ${MAX_QUEUE_WAIT_MS}ms while waiting for "${label}". ` +
                `A previous Discord mutation did not finish in time; retry the call.`,
            ),
          );
        }, MAX_QUEUE_WAIT_MS),
      };
      waiter.timer.unref();
      this.waiters.push(waiter);
    });
  }

  private release(): void {
    const next = this.waiters.shift();

    if (next) {
      clearTimeout(next.timer);
      next.grant();
      return;
    }

    this.running = false;
    this.notifyIdle();
  }

  private notifyIdle(): void {
    if (this.isBusy() || this.idleListeners.size === 0) {
      return;
    }

    const listeners = [...this.idleListeners];
    this.idleListeners.clear();
    for (const listener of listeners) {
      listener();
    }
  }
}

export const mutationQueue = new MutationQueue();

/**
 * Wraps a tool registrar so every non-read-only handler runs through the
 * mutation queue. Read-only tools pass through untouched: they must stay
 * responsive while a slow mutation is running.
 */
export function withMutationQueue(registrar: McpServer["registerTool"]): McpServer["registerTool"] {
  const invokeRegistrar = registrar as unknown as LooseRegistrar;

  const wrappedRegistrar: LooseRegistrar = (name, config, handler) => {
    if (config.annotations?.readOnlyHint === true || isExclusiveHandler(handler)) {
      return invokeRegistrar(name, config, handler);
    }

    const queuedHandler: ToolHandler = (...args) =>
      mutationQueue.run(name, () => (handler as ToolHandler)(...args));

    return invokeRegistrar(name, config, queuedHandler);
  };

  return wrappedRegistrar as unknown as McpServer["registerTool"];
}

/**
 * Wraps a single handler so it runs exclusively. Used by restore apply, whose
 * pre-mutation backup and partial-failure handling require a quiet guild.
 * The marker lets `withMutationQueue` avoid queueing the same handler twice
 * (which would deadlock behind itself).
 */
export function withExclusiveMutation<Args extends unknown[], Result>(
  handler: (...args: Args) => Result,
  label = "exclusive mutation",
): (...args: Args) => Promise<Awaited<Result>> {
  const exclusiveHandler = (...args: Args): Promise<Awaited<Result>> =>
    mutationQueue.runExclusive(label, () => handler(...args));

  Object.defineProperty(exclusiveHandler, EXCLUSIVE_MUTATION_MARKER, {
    value: true,
    enumerable: false,
  });

  return exclusiveHandler;
}

function isExclusiveHandler(handler: unknown): boolean {
  return (
    typeof handler === "function" &&
    (handler as unknown as Record<symbol, unknown>)[EXCLUSIVE_MUTATION_MARKER] === true
  );
}
