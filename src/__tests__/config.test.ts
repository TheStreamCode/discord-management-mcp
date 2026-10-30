import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const originalEnv = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  BACKUP_DIR: process.env.BACKUP_DIR,
  LOG_LEVEL: process.env.LOG_LEVEL,
  ENABLE_MESSAGE_CONTENT: process.env.ENABLE_MESSAGE_CONTENT,
  ENABLE_GUILD_MEMBERS: process.env.ENABLE_GUILD_MEMBERS,
};

const ENV_KEYS = [
  "DISCORD_TOKEN",
  "BACKUP_DIR",
  "LOG_LEVEL",
  "ENABLE_MESSAGE_CONTENT",
  "ENABLE_GUILD_MEMBERS",
] as const;

async function importConfigModule() {
  vi.resetModules();
  return import("../config.js");
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const original = originalEnv[key];

    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
}

describe("loadConfig", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = process.cwd();
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
    process.chdir(await mkdtemp(join(tmpdir(), "discord-config-")));
  });

  afterEach(async () => {
    const tempCwd = process.cwd();
    process.chdir(cwd);
    restoreEnv();
    await rm(tempCwd, { recursive: true, force: true });
  });

  test("loads dotenv syntax from .env.local when process.env token is missing", async () => {
    await writeFile(".env.local", "DISCORD_TOKEN=dotenv-token\n");
    const { loadConfig } = await importConfigModule();

    expect(loadConfig()).toEqual({
      discordToken: "dotenv-token",
      backupDir: join(process.cwd(), "backups"),
      projectRoot: process.cwd(),
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

  test("strips unquoted inline comments from .env.local values", async () => {
    await writeFile(
      ".env.local",
      [
        "DISCORD_TOKEN=file-token # local development token",
        "BACKUP_DIR=local-backups # keep backups per checkout",
        "LOG_LEVEL=debug # verbose while debugging",
      ].join("\n"),
    );
    const { loadConfig } = await importConfigModule();

    expect(loadConfig()).toMatchObject({
      discordToken: "file-token",
      backupDir: join(process.cwd(), "local-backups"),
      logLevel: "debug",
    });
  });

  test("keeps hashes inside quoted values and unspaced hashes untouched", async () => {
    await writeFile(".env.local", 'DISCORD_TOKEN="file#token" # quoted hash kept\n');
    const { loadConfig } = await importConfigModule();
    expect(loadConfig().discordToken).toBe("file#token");

    await writeFile(".env.local", "DISCORD_TOKEN=file#token\n");
    const reloaded = await importConfigModule();
    expect(reloaded.loadConfig().discordToken).toBe("file#token");
  });

  test("strips a trailing comment after a quoted value", async () => {
    await writeFile(".env.local", "DISCORD_TOKEN='quoted-token' # comment\n");
    const { loadConfig } = await importConfigModule();

    expect(loadConfig().discordToken).toBe("quoted-token");
  });

  test("validates LOG_LEVEL against the supported enum", async () => {
    await writeFile(".env.local", "DISCORD_TOKEN=token\nLOG_LEVEL=INFO\n");
    const { loadConfig } = await importConfigModule();

    expect(loadConfig().logLevel).toBe("info");
  });

  test("rejects an unsupported LOG_LEVEL with an actionable error", async () => {
    await writeFile(".env.local", "DISCORD_TOKEN=token\nLOG_LEVEL=verbose\n");
    const { loadConfig } = await importConfigModule();

    expect(() => loadConfig()).toThrow("LOG_LEVEL must be one of error, warn, info, debug");
  });

  test("prefers process.env LOG_LEVEL over .env.local", async () => {
    process.env.LOG_LEVEL = "error";
    await writeFile(".env.local", "DISCORD_TOKEN=token\nLOG_LEVEL=debug\n");
    const { loadConfig } = await importConfigModule();

    expect(loadConfig().logLevel).toBe("error");
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

describe("resolveBackupDir", () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "discord-config-root-"));
    outside = await mkdtemp(join(tmpdir(), "discord-config-outside-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  test("resolves a relative directory without creating it", async () => {
    const { resolveBackupDir } = await importConfigModule();
    const resolved = resolveBackupDir(root, "backups/nested");

    expect(resolved).toBe(join(root, "backups", "nested"));
    expect(existsSync(resolved)).toBe(false);
  });

  test("rejects absolute and escaping paths", async () => {
    const { resolveBackupDir } = await importConfigModule();

    expect(() => resolveBackupDir(root, join(root, "absolute"))).toThrow(
      "relative to the project directory",
    );
    expect(() => resolveBackupDir(root, "../outside")).toThrow("stay inside the project directory");
    expect(() => resolveBackupDir(root, ".")).toThrow("stay inside the project directory");
    expect(() => resolveBackupDir(root, "  ")).toThrow("BACKUP_DIR cannot be empty");
  });

  test.skipIf(process.platform !== "win32")(
    "rejects a Windows junction inside the project that points outside",
    async () => {
      await symlink(outside, join(root, "linked"), "junction");
      const { resolveBackupDir } = await importConfigModule();

      expect(() => resolveBackupDir(root, "linked")).toThrow("symbolic links or junctions");
      expect(() => resolveBackupDir(root, "linked/backups")).toThrow("symbolic links or junctions");
    },
  );

  test.skipIf(process.platform !== "win32")(
    "rejects a Windows junction even when it points inside the project",
    async () => {
      await mkdir(join(root, "real-backups"));
      await symlink(join(root, "real-backups"), join(root, "alias"), "junction");
      const { resolveBackupDir } = await importConfigModule();

      expect(() => resolveBackupDir(root, "alias")).toThrow("symbolic links or junctions");
    },
  );

  test.skipIf(process.platform !== "win32")(
    "rejects a junction in an intermediate component",
    async () => {
      await mkdir(join(root, "nested"));
      await symlink(outside, join(root, "nested", "linked"), "junction");
      const { resolveBackupDir } = await importConfigModule();

      expect(() => resolveBackupDir(root, "nested/linked/backups")).toThrow(
        "symbolic links or junctions",
      );
    },
  );

  test.skipIf(process.platform !== "win32")(
    "re-validates containment when a junction appears after startup",
    async () => {
      const { assertBackupDirInsideProject, resolveBackupDir } = await importConfigModule();
      const accepted = resolveBackupDir(root, "nested/linked/backups");

      expect(() => assertBackupDirInsideProject(root, accepted)).not.toThrow();

      await mkdir(join(root, "nested"));
      await symlink(outside, join(root, "nested", "linked"), "junction");

      expect(() => assertBackupDirInsideProject(root, accepted)).toThrow(
        "symbolic links or junctions",
      );
    },
  );
});
