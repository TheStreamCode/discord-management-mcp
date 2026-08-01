import type * as DiscordJs from "discord.js";
import { describe, expect, test, vi } from "vitest";

const discordMock = vi.hoisted(() => ({ attempts: 0, instances: 0 }));

vi.mock("discord.js", async (importOriginal) => {
  const actual = await importOriginal<typeof DiscordJs>();
  const { EventEmitter } = await import("node:events");

  class FakeClient extends EventEmitter {
    constructor() {
      super();
      discordMock.instances += 1;
    }

    isReady() {
      return false;
    }

    async login() {
      discordMock.attempts += 1;
      if (discordMock.attempts === 1) {
        throw new Error("invalid token");
      }

      queueMicrotask(() => this.emit(actual.Events.ClientReady, this));
      return "test-token";
    }

    destroy() {}
  }

  return { ...actual, Client: FakeClient };
});

import { DiscordClientManager } from "../discordClient.js";

describe("DiscordClientManager", () => {
  test("clears a failed login so a later call can retry with a fresh client", async () => {
    const manager = new DiscordClientManager("test-token");

    await expect(manager.getClient()).rejects.toThrow("invalid token");
    await expect(manager.getClient()).resolves.toBeDefined();
    expect(discordMock.attempts).toBe(2);
    expect(discordMock.instances).toBe(2);
  });
});
