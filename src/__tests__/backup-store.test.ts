import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import {
  backupDirectoryExists,
  createBackupId,
  listBackups,
  readSnapshot,
  validateBackupId,
  writeSnapshot,
} from "../backup/store.js";
import type { Snapshot } from "../backup/schema.js";

function coverage(complete = true) {
  return {
    channels: { fetched: 0, cacheSize: 0, hiddenKeys: [], complete },
  };
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    schemaVersion: 2,
    capturedAt: "2026-05-29T12:34:56.000Z",
    coverage: coverage(),
    guild: {
      id: "guild-123",
      name: "Test Guild",
      icon: null,
      ownerId: "owner-1",
      preferredLocale: "en-US",
      verificationLevel: 1,
      defaultMessageNotifications: 0,
      explicitContentFilter: 0,
      features: [],
    },
    roles: [],
    channels: [],
    autoModRules: [],
    scheduledEvents: [],
    ...overrides,
  } as Snapshot;
}

async function createBackupDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "discord-backups-"));
}

function validBackupId(): string {
  return "2026-05-29T12-34-56-000Z-guild-123.json";
}

describe("backup store", () => {
  test("creates filename-safe backup ids", () => {
    const id = createBackupId(new Date("2026-05-29T12:34:56.000Z"), "123");

    expect(id).toBe("2026-05-29T12-34-56-000Z-123.json");
    expect(id).toMatch(/^[A-Za-z0-9._-]+\.json$/);
  });

  test("writes, lists, and reads snapshots from a backup directory", async () => {
    const backupDir = await createBackupDir();

    try {
      const first = snapshot({ capturedAt: "2026-05-29T12:00:00.000Z" });
      const second = snapshot({ capturedAt: "2026-05-29T13:00:00.000Z" });
      const firstId = await writeSnapshot(backupDir, first, new Date(first.capturedAt));
      const secondId = await writeSnapshot(backupDir, second, new Date(second.capturedAt));

      await expect(readSnapshot(backupDir, firstId)).resolves.toEqual(first);
      await expect(readSnapshot(backupDir, secondId)).resolves.toEqual(second);
      await expect(listBackups(backupDir)).resolves.toEqual([secondId, firstId]);
      await expect(backupDirectoryExists(backupDir)).resolves.toBe(true);
    } finally {
      await rm(backupDir, { recursive: true, force: true });
    }
  });

  test("createBackup writes the directory only on write", async () => {
    const parent = await createBackupDir();
    const backupDir = join(parent, "nested", "backups");

    try {
      await expect(backupDirectoryExists(backupDir)).resolves.toBe(false);
      await expect(listBackups(backupDir)).resolves.toEqual([]);
      expect(existsSync(backupDir)).toBe(false);

      await expect(readSnapshot(backupDir, validBackupId())).rejects.toThrow(
        "Backup directory does not exist",
      );
      expect(existsSync(backupDir)).toBe(false);

      await writeSnapshot(backupDir, snapshot());
      expect(existsSync(backupDir)).toBe(true);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("lists only valid backup files and ignores leftovers from a crash", async () => {
    const backupDir = await createBackupDir();
    const backupId = validBackupId();

    try {
      await writeSnapshot(backupDir, snapshot(), new Date("2026-05-29T12:34:56.000Z"));
      await writeFile(join(backupDir, "notes.txt"), "not a backup", "utf8");
      await writeFile(join(backupDir, "backup.json"), "{}", "utf8");
      await writeFile(join(backupDir, `${backupId}.1234.crashed.tmp`), '{"truncated":', "utf8");
      await writeFile(join(backupDir, "2026-05-29T12-34-56.000Z-guild.json"), "{}", "utf8");
      await mkdir(join(backupDir, "2026-05-29T13-00-00-000Z-directory.json"));

      await expect(listBackups(backupDir)).resolves.toEqual([backupId]);
      await expect(readSnapshot(backupDir, backupId)).resolves.toEqual(
        snapshot({ capturedAt: "2026-05-29T12:34:56.000Z" }),
      );
    } finally {
      await rm(backupDir, { recursive: true, force: true });
    }
  });

  test("does not report a backup as created when the persisted payload is invalid", async () => {
    const backupDir = await createBackupDir();

    try {
      const invalid = snapshot({
        roles: [{ id: "role-without-required-fields" }],
      } as unknown as Partial<Snapshot>);

      await expect(writeSnapshot(backupDir, invalid)).rejects.toThrow(
        "Invalid backup snapshot at roles.0",
      );
      await expect(listBackups(backupDir)).resolves.toEqual([]);
      const leftovers = await readdir(backupDir);
      expect(leftovers.filter((entry) => entry.endsWith(".json"))).toEqual([]);
      expect(leftovers.filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
    } finally {
      await rm(backupDir, { recursive: true, force: true });
    }
  });

  test("does not leave temp files behind after a successful write", async () => {
    const backupDir = await createBackupDir();

    try {
      await writeSnapshot(backupDir, snapshot(), new Date("2026-05-29T12:34:56.000Z"));
      const entries = await readdir(backupDir);

      expect(entries.filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
      expect(entries).toHaveLength(1);
    } finally {
      await rm(backupDir, { recursive: true, force: true });
    }
  });

  test("does not overwrite an existing backup when IDs collide", async () => {
    const backupDir = await createBackupDir();
    const capturedAt = "2026-05-29T12:00:00.000Z";
    const original = snapshot({ capturedAt });

    try {
      const backupId = await writeSnapshot(backupDir, original, new Date(capturedAt));

      await expect(
        writeSnapshot(
          backupDir,
          snapshot({ capturedAt, guild: { ...original.guild, name: "Replacement" } }),
          new Date(capturedAt),
        ),
      ).rejects.toMatchObject({ code: "EEXIST" });
      await expect(readSnapshot(backupDir, backupId)).resolves.toEqual(original);
    } finally {
      await rm(backupDir, { recursive: true, force: true });
    }
  });

  test("accepts a v1 payload and upcasts it to v2 with default coverage", async () => {
    const backupDir = await createBackupDir();

    try {
      await mkdir(backupDir, { recursive: true });
      const legacy = {
        schemaVersion: 1,
        capturedAt: "2026-05-29T12:34:56.000Z",
        guild: {
          id: "guild-123",
          name: "Test Guild",
          icon: null,
          ownerId: null,
          preferredLocale: null,
          verificationLevel: 0,
          defaultMessageNotifications: 0,
          explicitContentFilter: 0,
          features: [],
        },
        roles: [],
        channels: [],
        autoModRules: [],
        scheduledEvents: [],
      };
      await writeFile(join(backupDir, validBackupId()), JSON.stringify(legacy), "utf8");

      const restored = await readSnapshot(backupDir, validBackupId());

      expect(restored).toMatchObject({
        schemaVersion: 2,
        coverage: {
          channels: { fetched: 0, cacheSize: 0, hiddenKeys: [], complete: false },
        },
      });
    } finally {
      await rm(backupDir, { recursive: true, force: true });
    }
  });

  test("round-trips v2 capture fields: coverage, role colors, channel audio fields", async () => {
    const backupDir = await createBackupDir();
    const v2Snapshot = snapshot({
      coverage: coverage(false),
      roles: [{
        key: "role:one",
        id: "role-1",
        name: "Role",
        color: 0x112233,
        hoist: false,
        mentionable: false,
        permissions: "0",
        position: 1,
        managed: false,
        colors: { primary: 0x112233, secondary: null, tertiary: 0x445566 },
      }],
      channels: [{
        key: "channel:one",
        id: "channel-1",
        name: "Voice",
        type: 2,
        parentKey: null,
        position: 0,
        bitrate: 64000,
        userLimit: 10,
        rtcRegion: "us-west",
        permissionOverwrites: [],
      }],
    } as unknown as Partial<Snapshot>);
    const backupId = await writeSnapshot(backupDir, v2Snapshot, new Date(v2Snapshot.capturedAt));

    await expect(readSnapshot(backupDir, backupId)).resolves.toEqual(v2Snapshot);
  });

  test("rejects invalid backup ids before filesystem access", () => {
    expect(() => validateBackupId("../backup.json")).toThrow("Invalid backupId");
    expect(() => validateBackupId("backup.json")).toThrow("Invalid backupId");
    expect(() =>
      validateBackupId("2026-05-29T12-34-56-000Z-guild.json/extra"),
    ).toThrow("Invalid backupId");
  });

  test("rejects snapshots with an unsupported schema", async () => {
    const backupDir = await createBackupDir();
    const invalidId = validBackupId();

    try {
      await mkdir(backupDir, { recursive: true });
      await writeFile(join(backupDir, invalidId), '{"schemaVersion":999}', "utf8");

      await expect(readSnapshot(backupDir, invalidId)).rejects.toThrow(
        "Unsupported backup schema version",
      );
    } finally {
      await rm(backupDir, { recursive: true, force: true });
    }
  });

  test("rejects malformed snapshot resources before restore code can use them", async () => {
    const backupDir = await createBackupDir();
    const invalidId = validBackupId();

    try {
      await mkdir(backupDir, { recursive: true });
      await writeFile(
        join(backupDir, invalidId),
        JSON.stringify({ ...snapshot(), roles: [{ id: "role-without-required-fields" }] }),
        "utf8",
      );

      await expect(readSnapshot(backupDir, invalidId)).rejects.toThrow(
        "Invalid backup snapshot at roles.0",
      );
    } finally {
      await rm(backupDir, { recursive: true, force: true });
    }
  });

  test("removes secret fields from legacy snapshots on read", async () => {
    const backupDir = await createBackupDir();
    const backupId = validBackupId();

    try {
      await mkdir(backupDir, { recursive: true });
      await writeFile(join(backupDir, backupId), JSON.stringify(snapshot({
        invites: [{ code: "invite-secret", url: "https://discord.gg/secret", uses: 1 }],
        webhooks: [{ id: "123", token: "webhook-secret", url: "https://discord.com/api/webhooks/123/secret" }],
      })), "utf8");

      const restored = await readSnapshot(backupDir, backupId);
      expect(restored.invites).toEqual([{ uses: 1 }]);
      expect(restored.webhooks).toEqual([{ id: "123" }]);
    } finally {
      await rm(backupDir, { recursive: true, force: true });
    }
  });

  test("rejects oversized backup files before parsing", async () => {
    const backupDir = await createBackupDir();
    const backupId = validBackupId();

    try {
      await mkdir(backupDir, { recursive: true });
      await writeFile(join(backupDir, backupId), " ".repeat(16 * 1024 * 1024 + 1), "utf8");

      await expect(readSnapshot(backupDir, backupId)).rejects.toThrow("size limit");
    } finally {
      await rm(backupDir, { recursive: true, force: true });
    }
  });

  test("rejects excessive JSON nesting before schema traversal", async () => {
    const backupDir = await createBackupDir();
    const backupId = validBackupId();
    let nested: Record<string, unknown> = {};
    for (let depth = 0; depth < 40; depth += 1) {
      nested = { nested };
    }

    try {
      await mkdir(backupDir, { recursive: true });
      await writeFile(join(backupDir, backupId), JSON.stringify({
        ...snapshot(),
        autoModRules: [{
          key: "rule:one",
          id: "rule-1",
          name: "Rule",
          enabled: true,
          eventType: 1,
          triggerType: 1,
          triggerMetadata: nested,
          actions: [],
          exemptRoleKeys: [],
          exemptChannelKeys: [],
        }],
      }), "utf8");

      await expect(readSnapshot(backupDir, backupId)).rejects.toThrow("JSON depth");
    } finally {
      await rm(backupDir, { recursive: true, force: true });
    }
  });

  test("reports an actionable error for a missing backup file", async () => {
    const backupDir = await createBackupDir();

    try {
      await writeSnapshot(backupDir, snapshot(), new Date("2026-05-29T12:34:56.000Z"));

      await expect(readSnapshot(backupDir, "2026-05-30T00-00-00-000Z-guild.json")).rejects.toThrow(
        "Backup not found",
      );
    } finally {
      await rm(backupDir, { recursive: true, force: true });
    }
  });

  test.skipIf(process.platform !== "win32")(
    "rejects a Windows junction masquerading as a backup file",
    async () => {
      const backupDir = await createBackupDir();
      const target = join(backupDir, "real-target");
      const junctionPath = join(backupDir, validBackupId());

      try {
        await mkdir(target);
        await symlink(target, junctionPath, "junction");

        await expect(readSnapshot(backupDir, validBackupId())).rejects.toThrow(
          "regular file, not a symbolic link, junction, or reparse point",
        );
      } finally {
        await rm(backupDir, { recursive: true, force: true });
      }
    },
  );

  test.skipIf(process.platform !== "win32")(
    "reports a symlinked backup directory as not a real directory",
    async () => {
      const parent = await createBackupDir();
      const target = join(parent, "real-backups");
      const linked = join(parent, "linked-backups");

      try {
        await mkdir(target);
        await symlink(target, linked, "junction");

        await expect(backupDirectoryExists(linked)).rejects.toThrow("real directory");
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    },
  );
});
