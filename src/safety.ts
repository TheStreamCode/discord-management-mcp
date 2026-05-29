import { readSnapshot, validateBackupId } from "./backup/store.js";

export type ConfirmationInput = {
  confirm?: boolean;
  reason?: string | null;
};

export type DestructiveBackupInput = {
  backupId?: string | null;
  allowWithoutBackup?: boolean;
};

export function requireConfirmation(input: ConfirmationInput): void {
  if (input.confirm !== true) {
    throw new Error("confirm: true is required for mutation actions.");
  }

  if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
    throw new Error("A non-empty reason is required for mutation actions.");
  }
}

export function requireDestructiveBackup(input: DestructiveBackupInput): void {
  if (input.allowWithoutBackup === true) {
    return;
  }

  if (typeof input.backupId === "string" && input.backupId.trim().length > 0) {
    validateBackupId(input.backupId);
    return;
  }

  throw new Error("backupId or allowWithoutBackup: true is required for destructive actions.");
}

export async function requireDestructiveBackupForGuild(
  input: DestructiveBackupInput,
  backupDir: string,
  guildId: string,
): Promise<void> {
  if (input.allowWithoutBackup === true) {
    return;
  }

  requireDestructiveBackup(input);
  const snapshot = await readSnapshot(backupDir, input.backupId!);

  if (snapshot.guild.id !== guildId) {
    throw new Error(
      `Backup guild mismatch: backup is for guild ${snapshot.guild.id}, but action targets guild ${guildId}.`,
    );
  }
}
