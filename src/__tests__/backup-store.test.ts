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
});
