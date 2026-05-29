import { describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  requireConfirmation,
  requireDestructiveBackup,
  requireDestructiveBackupForGuild,
} from "../safety.js";
import { writeSnapshot } from "../backup/store.js";
import type { Snapshot } from "../backup/schema.js";

function snapshot(guildId: string): Snapshot {
  return {
    schemaVersion: 1,
    guild: {
      id: guildId,
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
  };
}

describe("requireConfirmation", () => {
  test("requires confirm true and a non-empty reason for mutation actions", () => {
    expect(() => requireConfirmation({})).toThrow("confirm: true is required");
    expect(() => requireConfirmation({ confirm: false })).toThrow("confirm: true is required");
    expect(() => requireConfirmation({ confirm: true })).toThrow("reason is required");
    expect(() => requireConfirmation({ confirm: true, reason: "  " })).toThrow("reason is required");
    expect(() => requireConfirmation({ confirm: true, reason: "planned change" })).not.toThrow();
  });
});

describe("requireDestructiveBackup", () => {
  test("requires backupId or allowWithoutBackup true for destructive actions", () => {
    expect(() => requireDestructiveBackup({})).toThrow(
      "backupId or allowWithoutBackup: true is required",
    );
    expect(() => requireDestructiveBackup({ backupId: "../backup.json" })).toThrow("Invalid backupId");
    expect(() =>
      requireDestructiveBackup({ backupId: "2026-05-29T12-34-56-000Z-123.json" }),
    ).not.toThrow();
    expect(() => requireDestructiveBackup({ allowWithoutBackup: true })).not.toThrow();
  });

  test("requires the backup to belong to the target guild", async () => {
    const backupDir = await mkdtemp(join(tmpdir(), "discord-backups-"));

    try {
      const backupId = await writeSnapshot(backupDir, snapshot("guild-1"));

      await expect(
        requireDestructiveBackupForGuild({ backupId }, backupDir, "guild-1"),
      ).resolves.toBeUndefined();
      await expect(
        requireDestructiveBackupForGuild({ backupId }, backupDir, "guild-2"),
      ).rejects.toThrow("Backup guild mismatch");
      await expect(
        requireDestructiveBackupForGuild({ allowWithoutBackup: true }, backupDir, "guild-2"),
      ).resolves.toBeUndefined();
    } finally {
      await rm(backupDir, { recursive: true, force: true });
    }
  });
});
