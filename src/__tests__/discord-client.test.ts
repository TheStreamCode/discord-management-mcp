import type * as DiscordJs from "discord.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Logger } from "../logger.js";

const discordMock = vi.hoisted(() => ({
  attempts: 0,
  instances: 0,
  clients: [] as unknown[],
  failLogins: 0,
  hangLogin: false,
  flipReadyAfterLoginAttempt: 0,
}));

vi.mock("discord.js", async (importOriginal) => {
  const actual = await importOriginal<typeof DiscordJs>();
  const { EventEmitter } = await import("node:events");

  class FakeClient extends EventEmitter {
    ready = false;
    destroyed = false;

    constructor() {
      super();
      discordMock.instances += 1;
      discordMock.clients.push(this);
    }

    isReady() {
      return this.ready;
    }

    async login() {
      discordMock.attempts += 1;
      const attempt = discordMock.attempts;

      if (discordMock.failLogins > 0) {
        discordMock.failLogins -= 1;
        throw new Error("invalid token");
      }

      if (discordMock.hangLogin) {
        return new Promise(() => undefined);
      }

      this.ready = true;
      queueMicrotask(() => {
        this.emit(actual.Events.ClientReady, this);
        if (discordMock.flipReadyAfterLoginAttempt === attempt) {
          this.ready = false;
        }
      });

      return "test-token";
    }

    async destroy() {
      this.destroyed = true;
    }
  }

  return { ...actual, Client: FakeClient };
});

import { DiscordClientManager } from "../discordClient.js";
import { Events } from "discord.js";

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

function fakeClient(index: number) {
  return discordMock.clients[index] as {
    ready: boolean;
    destroyed: boolean;
    emit: (event: string, ...args: unknown[]) => boolean;
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("DiscordClientManager", () => {
  beforeEach(() => {
    discordMock.attempts = 0;
    discordMock.instances = 0;
    discordMock.clients = [];
    discordMock.failLogins = 0;
    discordMock.hangLogin = false;
    discordMock.flipReadyAfterLoginAttempt = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("clears a failed login so a later call can retry with a fresh client", async () => {
    discordMock.failLogins = 1;
    const manager = new DiscordClientManager("test-token", { logger: createFakeLogger().logger });

    await expect(manager.getClient()).rejects.toThrow("invalid token");
    await expect(manager.getClient()).resolves.toBeDefined();
    expect(discordMock.attempts).toBe(2);
    expect(discordMock.instances).toBe(2);
    expect(fakeClient(0).destroyed).toBe(true);
  });

  test("reconnects when the client is not ready after login resolves", async () => {
    discordMock.flipReadyAfterLoginAttempt = 1;
    const { entries, logger } = createFakeLogger();
    const manager = new DiscordClientManager("test-token", { logger });

    await expect(manager.getClient()).resolves.toBeDefined();

    expect(discordMock.instances).toBe(2);
    expect(fakeClient(0).destroyed).toBe(true);
    expect(entries.some((entry) => entry.message.includes("not ready after login"))).toBe(true);
  });

  test("logs persistent client errors with redacted messages", async () => {
    const { entries, logger } = createFakeLogger();
    const manager = new DiscordClientManager("test-token", { logger });
    await manager.getClient();
    const token = "abcdefghijklmnopqrstuv.wxyzab.abcdefghijklmnopqrstuv";

    expect(() => fakeClient(0).emit(Events.Error, new Error(`token ${token}`))).not.toThrow();

    const entry = entries.find((candidate) => candidate.message === "Discord client error.");
    expect(entry).toBeDefined();
    expect(entry?.fields?.error).toContain("[redacted Discord token]");
    expect(JSON.stringify(entry)).not.toContain(token);
  });

  test("logs persistent shard errors with the shard id", async () => {
    const { entries, logger } = createFakeLogger();
    const manager = new DiscordClientManager("test-token", { logger });
    await manager.getClient();

    expect(() => fakeClient(0).emit(Events.ShardError, new Error("gateway closed"), 3)).not.toThrow();

    const entry = entries.find((candidate) => candidate.message === "Discord shard error.");
    expect(entry?.fields).toMatchObject({ shardId: 3 });
    expect(entry?.fields?.error).toBe("gateway closed");
  });

  test("resets the client after a non-recoverable shard disconnect", async () => {
    const { entries, logger } = createFakeLogger();
    const manager = new DiscordClientManager("test-token", { logger });
    const first = await manager.getClient();

    fakeClient(0).emit(Events.ShardDisconnect, { code: 4004, reason: "Authentication failed" }, 0);

    await vi.waitFor(() => {
      expect(fakeClient(0).destroyed).toBe(true);
    });
    expect(entries.some((entry) => entry.level === "error" && entry.message.includes("non-recoverable"))).toBe(true);

    const second = await manager.getClient();
    expect(second).not.toBe(first);
    expect(discordMock.instances).toBe(2);
  });

  test("keeps the client after a recoverable shard disconnect", async () => {
    const manager = new DiscordClientManager("test-token", { logger: createFakeLogger().logger });
    const first = await manager.getClient();

    fakeClient(0).emit(Events.ShardDisconnect, { code: 4000, reason: "Unknown error" }, 0);
    await flushMicrotasks();

    await expect(manager.getClient()).resolves.toBe(first);
    expect(discordMock.instances).toBe(1);
    expect(fakeClient(0).destroyed).toBe(false);
  });

  test("logs a login timeout and clears the failed client", async () => {
    vi.useFakeTimers();
    discordMock.hangLogin = true;
    const { entries, logger } = createFakeLogger();
    const manager = new DiscordClientManager("test-token", { logger });

    const pending = manager.getClient();
    const assertion = expect(pending).rejects.toThrow("login timed out");
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;

    expect(entries.some((entry) => entry.level === "error" && entry.message.includes("timed out"))).toBe(true);
    expect(firstClientDestroyed()).toBe(true);
  });

  test("destroy clears the cached client so the next call reconnects", async () => {
    const manager = new DiscordClientManager("test-token", { logger: createFakeLogger().logger });
    await manager.getClient();

    await manager.destroy();
    expect(fakeClient(0).destroyed).toBe(true);

    await expect(manager.getClient()).resolves.toBeDefined();
    expect(discordMock.instances).toBe(2);
  });

  function firstClientDestroyed(): boolean {
    return fakeClient(0).destroyed;
  }
});
