import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createShutdownController, serverInstructions } from "../index.js";
import { createLogger, type Logger } from "../logger.js";
import { mutationQueue } from "../mutationQueue.js";

type LogEntry = { level: string; message: string; fields?: Record<string, unknown> };

function createFakeLogger(): { entries: LogEntry[]; logger: Logger } {
  const entries: LogEntry[] = [];
  const capture = (level: string) => (message: string, fields?: Record<string, unknown>) => {
    entries.push({ level, message, fields });
  };

  return {
    entries,
    logger: {
      error: capture("error"),
      warn: capture("warn"),
      info: capture("info"),
      debug: capture("debug"),
    },
  };
}

function createHarness(options: { drainTimeoutMs?: number } = {}) {
  const events: string[] = [];
  const logger = createFakeLogger();

  const transport = {
    close: vi.fn(async () => {
      events.push("transport:close");
    }),
    onclose: undefined as (() => void) | undefined,
  };
  const discord = {
    destroy: vi.fn(async () => {
      events.push("discord:destroy");
    }),
  };
  const exit = vi.fn((code: number) => {
    events.push(`exit:${code}`);
  });

  const controller = createShutdownController({
    transport,
    discord,
    logger: logger.logger,
    exit,
    drainTimeoutMs: options.drainTimeoutMs ?? 1_000,
  });

  return { controller, transport, discord, exit, events, entries: logger.entries };
}

async function startBlockingMutation(label = "restore apply") {
  let release: (() => void) | undefined;
  const running = mutationQueue.run(
    label,
    () => new Promise<void>((resolve) => {
      release = resolve;
    }),
  );

  await Promise.resolve();
  await Promise.resolve();

  return {
    release: () => {
      release?.();
      return running;
    },
  };
}

describe("server instructions", () => {
  test("advertises non-empty, bounded MCP instructions", () => {
    expect(serverInstructions.length).toBeGreaterThan(0);
    expect(serverInstructions.length).toBeLessThanOrEqual(2_048);
    expect(serverInstructions).not.toContain("\u2014");
    expect(serverInstructions).toContain("confirm: true");
  });
});

describe("createShutdownController", () => {
  beforeEach(async () => {
    await mutationQueue.drain(1_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("closes the transport, destroys the client, and exits 0", async () => {
    const harness = createHarness();

    await harness.controller.shutdown("SIGTERM");

    expect(harness.transport.close).toHaveBeenCalledTimes(1);
    expect(harness.discord.destroy).toHaveBeenCalledTimes(1);
    expect(harness.exit).toHaveBeenCalledWith(0);
    expect(harness.events).toEqual(["transport:close", "discord:destroy", "exit:0"]);
    expect(harness.entries.some((entry) => entry.message === "SHUTDOWN_PARTIAL")).toBe(false);
  });

  test("runs the shutdown sequence only once", async () => {
    const harness = createHarness();

    await Promise.all([
      harness.controller.shutdown("SIGINT"),
      harness.controller.shutdown("transport closed"),
    ]);
    await harness.controller.shutdown("SIGTERM");

    expect(harness.transport.close).toHaveBeenCalledTimes(1);
    expect(harness.discord.destroy).toHaveBeenCalledTimes(1);
    expect(harness.exit).toHaveBeenCalledTimes(1);
  });

  test("waits for in-flight mutations before destroying the client", async () => {
    const mutation = await startBlockingMutation();
    const harness = createHarness({ drainTimeoutMs: 1_000 });

    try {
      const shutdown = harness.controller.shutdown("SIGTERM");
      await Promise.resolve();
      await Promise.resolve();

      expect(harness.discord.destroy).not.toHaveBeenCalled();
      expect(harness.exit).not.toHaveBeenCalled();

      await mutation.release();
      await shutdown;

      expect(harness.exit).toHaveBeenCalledWith(0);
      expect(harness.entries.some((entry) => entry.message === "SHUTDOWN_PARTIAL")).toBe(false);
    } finally {
      await mutation.release();
    }
  });

  test("logs SHUTDOWN_PARTIAL when the drain timeout expires", async () => {
    const mutation = await startBlockingMutation();
    const harness = createHarness({ drainTimeoutMs: 10 });

    try {
      await harness.controller.shutdown("SIGTERM");

      const partial = harness.entries.find((entry) => entry.message === "SHUTDOWN_PARTIAL");
      expect(partial).toBeDefined();
      expect(partial?.fields).toMatchObject({ event: "SHUTDOWN_PARTIAL" });
      expect(harness.exit).toHaveBeenCalledWith(0);
    } finally {
      await mutation.release();
    }
  });

  test("writes SHUTDOWN_PARTIAL as a JSON stderr line", async () => {
    const lines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(
      (chunk: string | Uint8Array, encodingOrCallback?: unknown, callback?: unknown) => {
        lines.push(String(chunk));
        const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
        if (typeof done === "function") {
          (done as () => void)();
        }
        return true;
      },
    );

    const transport = { close: vi.fn(async () => undefined) };
    const discord = { destroy: vi.fn(async () => undefined) };
    const exit = vi.fn();
    const controller = createShutdownController({
      transport,
      discord,
      logger: createLogger("info"),
      exit,
      drainTimeoutMs: 10,
    });

    const mutation = await startBlockingMutation();

    try {
      await controller.shutdown("SIGTERM");

      const records = lines
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const partial = records.find((record) => record.event === "SHUTDOWN_PARTIAL");

      expect(partial).toMatchObject({ level: "error", event: "SHUTDOWN_PARTIAL" });
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      await mutation.release();
    }
  });

  test("continues shutdown when closing the transport fails", async () => {
    const harness = createHarness();
    harness.transport.close.mockRejectedValueOnce(new Error("transport already closed"));

    await harness.controller.shutdown("SIGTERM");

    expect(harness.entries.some((entry) => entry.message.includes("Failed to close the MCP transport"))).toBe(true);
    expect(harness.discord.destroy).toHaveBeenCalledTimes(1);
    expect(harness.exit).toHaveBeenCalledWith(0);
  });

  test("continues shutdown when destroying the Discord client fails", async () => {
    const harness = createHarness();
    harness.discord.destroy.mockRejectedValueOnce(new Error("gateway already gone"));

    await harness.controller.shutdown("SIGTERM");

    expect(harness.entries.some((entry) => entry.message.includes("Failed to destroy the Discord client during shutdown"))).toBe(true);
    expect(harness.exit).toHaveBeenCalledWith(0);
  });
});
