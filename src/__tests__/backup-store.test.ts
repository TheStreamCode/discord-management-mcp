import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import {
  createBackupId,
  ensureBackupDir,
  listBackups,
  readSnapshot,
  validateBackupId,
  writeSnapshot,
} from "../backup/store.js";
import type { Snapshot } from "../backup/schema.js";

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    schemaVersion: 1,
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
    capturedAt: "2026-05-29T12:34:56.000Z",
    ...overrides,
  };
}

describe("backup store", () => {
  test("creates filename-safe backup ids", () => {
    const id = createBackupId(new Date("2026-05-29T12:34:56.000Z"), "123");

    expect(id).toBe("2026-05-29T12-34-56-000Z-123.json");
    expect(id).toMatch(/^[A-Za-z0-9._-]+\.json$/);
  });

  test("writes, lists, and reads snapshots from a backup directory", async () => {
    const backupDir = await mkdtemp(join(tmpdir(), "discord-backups-"));

    try {
      await ensureBackupDir(backupDir);
      const first = snapshot({ capturedAt: "2026-05-29T12:00:00.000Z" });
      const second = snapshot({ capturedAt: "2026-05-29T13:00:00.000Z" });
      const firstId = await writeSnapshot(backupDir, first, new Date(first.capturedAt));
      const secondId = await writeSnapshot(backupDir, second, new Date(second.capturedAt));

      await expect(readSnapshot(backupDir, firstId)).resolves.toEqual(first);
      await expect(readSnapshot(backupDir, secondId)).resolves.toEqual(second);
      await expect(listBackups(backupDir)).resolves.toEqual([secondId, firstId]);
    } finally {
      await rm(backupDir, { recursive: true, force: true });
    }
  });

  test("does not overwrite an existing backup when IDs collide", async () => {
    const backupDir = await mkdtemp(join(tmpdir(), "discord-backups-"));
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

  test("rejects invalid backup ids before filesystem access", async () => {
    expect(() => validateBackupId("../backup.json")).toThrow("Invalid backupId");
    expect(() => validateBackupId("backup.json")).toThrow("Invalid backupId");
    expect(() =>
      validateBackupId("2026-05-29T12-34-56-000Z-guild.json/extra"),
    ).toThrow("Invalid backupId");
  });

  test("rejects snapshots with an unsupported schema", async () => {
    const backupDir = await mkdtemp(join(tmpdir(), "discord-backups-"));
    const invalidId = "2026-05-29T12-34-56-000Z-guild.json";

    try {
      await ensureBackupDir(backupDir);
      await writeFile(join(backupDir, invalidId), '{"schemaVersion":999}', "utf8");

      await expect(readSnapshot(backupDir, invalidId)).rejects.toThrow(
        "Unsupported backup schema version",
      );
    } finally {
      await rm(backupDir, { recursive: true, force: true });
    }
  });

  test("rejects malformed snapshot resources before restore code can use them", async () => {
    const backupDir = await mkdtemp(join(tmpdir(), "discord-backups-"));
    const invalidId = "2026-05-29T12-34-56-000Z-guild.json";

    try {
      await ensureBackupDir(backupDir);
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
    const backupDir = await mkdtemp(join(tmpdir(), "discord-backups-"));
    const backupId = "2026-05-29T12-34-56-000Z-guild.json";

    try {
      await ensureBackupDir(backupDir);
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
    const backupDir = await mkdtemp(join(tmpdir(), "discord-backups-"));
    const backupId = "2026-05-29T12-34-56-000Z-guild.json";

    try {
      await ensureBackupDir(backupDir);
      await writeFile(join(backupDir, backupId), " ".repeat(16 * 1024 * 1024 + 1), "utf8");

      await expect(readSnapshot(backupDir, backupId)).rejects.toThrow("size limit");
    } finally {
      await rm(backupDir, { recursive: true, force: true });
    }
  });

  test("rejects excessive JSON nesting before schema traversal", async () => {
    const backupDir = await mkdtemp(join(tmpdir(), "discord-backups-"));
    const backupId = "2026-05-29T12-34-56-000Z-guild.json";
    let nested: Record<string, unknown> = {};
    for (let depth = 0; depth < 40; depth += 1) {
      nested = { nested };
    }

    try {
      await ensureBackupDir(backupDir);
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
});
