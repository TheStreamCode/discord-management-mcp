import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  MAX_QUEUE_WAIT_MS,
  mutationQueue,
  withExclusiveMutation,
  withMutationQueue,
} from "../mutationQueue.js";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

type RegisteredTool = {
  config: { annotations?: { readOnlyHint?: boolean } };
  handler: (...args: unknown[]) => unknown;
};

function createRegistrar(): {
  registerTool: ReturnType<typeof withMutationQueue>;
  tools: Map<string, RegisteredTool>;
} {
  const tools = new Map<string, RegisteredTool>();
  const registrar = (name: string, config: RegisteredTool["config"], handler: RegisteredTool["handler"]) => {
    tools.set(name, { config, handler });
    return {};
  };

  return {
    registerTool: withMutationQueue(registrar as never),
    tools,
  };
}

describe("mutationQueue", () => {
  beforeEach(async () => {
    await mutationQueue.drain(1_000);
  });

  test("serializes mutations in FIFO order", async () => {
    const order: string[] = [];

    const first = mutationQueue.run("first", async () => {
      order.push("first:start");
      await delay(20);
      order.push("first:end");
    });
    const second = mutationQueue.run("second", async () => {
      order.push("second:start");
      order.push("second:end");
    });

    expect(mutationQueue.isBusy()).toBe(true);
    expect(mutationQueue.depth()).toBe(2);

    await Promise.all([first, second]);

    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
    expect(mutationQueue.isBusy()).toBe(false);
    expect(mutationQueue.depth()).toBe(0);
  });

  test("rejects a waiter that exceeds the maximum queue wait", async () => {
    vi.useFakeTimers();
    let releaseFirst: (() => void) | undefined;

    try {
      const first = mutationQueue.run(
        "blocking",
        () => new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
      );
      await flushMicrotasks();
      expect(mutationQueue.depth()).toBe(1);

      const second = mutationQueue.run("waiting", async () => undefined);
      const secondAssertion = expect(second).rejects.toThrow("Mutation queue timeout");

      await vi.advanceTimersByTimeAsync(MAX_QUEUE_WAIT_MS);
      await secondAssertion;
      expect(mutationQueue.depth()).toBe(1);

      releaseFirst?.();
      await first;
      expect(mutationQueue.isBusy()).toBe(false);
    } finally {
      releaseFirst?.();
      vi.useRealTimers();
    }
  });

  test("rejects exclusive mutations immediately while another mutation runs", async () => {
    let releaseFirst: (() => void) | undefined;
    const first = mutationQueue.run(
      "blocking",
      () => new Promise<void>((resolve) => {
        releaseFirst = resolve;
      }),
    );

    try {
      await flushMicrotasks();
      await expect(
        mutationQueue.runExclusive("restore apply", async () => undefined),
      ).rejects.toThrow("exclusive operation");
      expect(mutationQueue.isBusy()).toBe(true);
    } finally {
      releaseFirst?.();
      await first;
    }
  });

  test("runs an exclusive mutation when the queue is idle", async () => {
    const result = await mutationQueue.runExclusive("restore apply", async () => "applied");

    expect(result).toBe("applied");
    expect(mutationQueue.isBusy()).toBe(false);
  });

  test("releases the lock when a mutation throws", async () => {
    await expect(
      mutationQueue.run("failing", async () => {
        throw new Error("mutation failed");
      }),
    ).rejects.toThrow("mutation failed");

    expect(mutationQueue.isBusy()).toBe(false);
    expect(mutationQueue.depth()).toBe(0);

    await expect(mutationQueue.run("after failure", async () => "ok")).resolves.toBe("ok");
  });

  test("releases the lock when an exclusive mutation throws", async () => {
    await expect(
      mutationQueue.runExclusive("failing exclusive", async () => {
        throw new Error("exclusive failed");
      }),
    ).rejects.toThrow("exclusive failed");

    expect(mutationQueue.isBusy()).toBe(false);
  });

  test("drain resolves true once the queue becomes idle", async () => {
    let releaseFirst: (() => void) | undefined;
    const first = mutationQueue.run(
      "blocking",
      () => new Promise<void>((resolve) => {
        releaseFirst = resolve;
      }),
    );

    try {
      await flushMicrotasks();
      const drained = mutationQueue.drain(5_000);
      releaseFirst?.();
      await first;

      await expect(drained).resolves.toBe(true);
    } finally {
      releaseFirst?.();
      await first;
    }
  });

  test("drain resolves false when the timeout expires", async () => {
    let releaseFirst: (() => void) | undefined;
    const first = mutationQueue.run(
      "blocking",
      () => new Promise<void>((resolve) => {
        releaseFirst = resolve;
      }),
    );

    try {
      await flushMicrotasks();
      await expect(mutationQueue.drain(10)).resolves.toBe(false);
    } finally {
      releaseFirst?.();
      await first;
    }
  });

  test("queues non-read-only handlers and leaves read-only handlers unqueued", async () => {
    const { registerTool, tools } = createRegistrar();

    registerTool(
      "discord_mutate" as never,
      { annotations: { readOnlyHint: false } } as never,
      (async () => "mutated") as never,
    );
    registerTool(
      "discord_list" as never,
      { annotations: { readOnlyHint: true } } as never,
      (async () => "listed") as never,
    );

    const mutate = tools.get("discord_mutate")!;
    const list = tools.get("discord_list")!;

    let releaseFirst: (() => void) | undefined;
    const first = mutationQueue.run(
      "blocking",
      () => new Promise<void>((resolve) => {
        releaseFirst = resolve;
      }),
    );

    try {
      await flushMicrotasks();

      await expect(list.handler()).resolves.toBe("listed");
      const queued = mutate.handler();

      let settled = false;
      void queued.then(() => {
        settled = true;
      });
      await flushMicrotasks();
      expect(settled).toBe(false);
      expect(mutationQueue.depth()).toBe(2);

      releaseFirst?.();
      await first;
      await expect(queued).resolves.toBe("mutated");
    } finally {
      releaseFirst?.();
      await first;
    }
  });

  test("does not double-queue a handler wrapped by withExclusiveMutation", async () => {
    const { registerTool, tools } = createRegistrar();

    registerTool(
      "discord_backup_restore_apply" as never,
      { annotations: { readOnlyHint: false } } as never,
      withExclusiveMutation((async () => "restored") as never),
    );

    const exclusive = tools.get("discord_backup_restore_apply")!;

    // If the registrar queued the wrapper and the wrapper acquired the queue
    // again, this would deadlock until the exclusive call rejects immediately.
    await expect(exclusive.handler()).resolves.toBe("restored");

    let releaseFirst: (() => void) | undefined;
    const first = mutationQueue.run(
      "blocking",
      () => new Promise<void>((resolve) => {
        releaseFirst = resolve;
      }),
    );

    try {
      await flushMicrotasks();
      await expect(exclusive.handler()).rejects.toThrow("exclusive operation");
    } finally {
      releaseFirst?.();
      await first;
    }
  });
});
