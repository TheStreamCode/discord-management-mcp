import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const originalDiscordToken = process.env.DISCORD_TOKEN;
const originalEnableMessageContent = process.env.ENABLE_MESSAGE_CONTENT;
const originalEnableGuildMembers = process.env.ENABLE_GUILD_MEMBERS;

async function importConfigModule() {
  vi.resetModules();
  return import("../config.js");
}

describe("loadConfig", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = process.cwd();
    delete process.env.DISCORD_TOKEN;
    delete process.env.ENABLE_MESSAGE_CONTENT;
    delete process.env.ENABLE_GUILD_MEMBERS;
    process.chdir(await mkdtemp(join(tmpdir(), "discord-config-")));
  });

  afterEach(async () => {
    const tempCwd = process.cwd();
    process.chdir(cwd);

    if (originalDiscordToken === undefined) {
      delete process.env.DISCORD_TOKEN;
    } else {
      process.env.DISCORD_TOKEN = originalDiscordToken;
    }

    if (originalEnableMessageContent === undefined) {
      delete process.env.ENABLE_MESSAGE_CONTENT;
    } else {
      process.env.ENABLE_MESSAGE_CONTENT = originalEnableMessageContent;
    }

    if (originalEnableGuildMembers === undefined) {
      delete process.env.ENABLE_GUILD_MEMBERS;
    } else {
      process.env.ENABLE_GUILD_MEMBERS = originalEnableGuildMembers;
    }

    await rm(tempCwd, { recursive: true, force: true });
  });

  test("loads dotenv syntax from .env.local when process.env token is missing", async () => {
    await writeFile(".env.local", "DISCORD_TOKEN=dotenv-token\n");
    const { loadConfig } = await importConfigModule();

    expect(loadConfig()).toEqual({
      discordToken: "dotenv-token",
      backupDir: join(process.cwd(), "backups"),
      logLevel: "info",
      enableMessageContent: false,
      enableGuildMembers: false,
    });
  });

  test("loads PowerShell syntax from .env.local when process.env token is missing", async () => {
    await writeFile(".env.local", '$env:DISCORD_TOKEN="powershell-token"\n');
    const { loadConfig } = await importConfigModule();

    expect(loadConfig().discordToken).toBe("powershell-token");
  });

  test("prefers process.env DISCORD_TOKEN over .env.local", async () => {
    process.env.DISCORD_TOKEN = "process-token";
    await writeFile(".env.local", "DISCORD_TOKEN=file-token\n");
    const { loadConfig } = await importConfigModule();

    expect(loadConfig().discordToken).toBe("process-token");
  });

  test("normalizes an optional Bot prefix", async () => {
    await writeFile(".env.local", "DISCORD_TOKEN=Bot raw-token\n");
    const { loadConfig } = await importConfigModule();

    expect(loadConfig().discordToken).toBe("raw-token");
  });

  test("throws a missing token error without leaking file values", async () => {
    await writeFile(".env.local", 'OTHER_SECRET="do-not-leak"\n');
    const { loadConfig } = await importConfigModule();

    expect(() => loadConfig()).toThrow("DISCORD_TOKEN is required");
    expect(() => loadConfig()).not.toThrow("do-not-leak");
  });

  test("rejects a Discord application public key used as the token", async () => {
    await writeFile(".env.local", `DISCORD_TOKEN=${"a".repeat(64)}\n`);
    const { loadConfig } = await importConfigModule();

    expect(() => loadConfig()).toThrow("Application Public Key");
  });

  test("rejects backup directories outside the project", async () => {
    await writeFile(".env.local", "DISCORD_TOKEN=token\nBACKUP_DIR=../outside\n");
    const { loadConfig } = await importConfigModule();

    expect(() => loadConfig()).toThrow("BACKUP_DIR must stay inside the project directory");
  });

  test("loads optional privileged intent flags from .env.local", async () => {
    await writeFile(
      ".env.local",
      "DISCORD_TOKEN=token\nENABLE_MESSAGE_CONTENT=true\nENABLE_GUILD_MEMBERS=1\n",
    );
    const { loadConfig } = await importConfigModule();

    expect(loadConfig()).toMatchObject({
      enableMessageContent: true,
      enableGuildMembers: true,
    });
  });

  test("rejects invalid boolean intent flags", async () => {
    await writeFile(".env.local", "DISCORD_TOKEN=token\nENABLE_MESSAGE_CONTENT=maybe\n");
    const { loadConfig } = await importConfigModule();

    expect(() => loadConfig()).toThrow("ENABLE_MESSAGE_CONTENT must be a boolean value");
  });
});
