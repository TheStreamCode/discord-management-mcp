import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { schemaVersion, type Snapshot } from "./schema.js";

const BACKUP_EXTENSION = ".json";
const BACKUP_ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[A-Za-z0-9._-]+\.json$/;

export async function ensureBackupDir(backupDir: string): Promise<void> {
  await mkdir(backupDir, { recursive: true });
}

export function createBackupId(date: Date, guildId: string): string {
  const timestamp = date.toISOString().replace(/[:.]/g, "-");
  const safeGuildId = guildId.replace(/[^A-Za-z0-9._-]/g, "_");

  return `${timestamp}-${safeGuildId}${BACKUP_EXTENSION}`;
}

export async function writeSnapshot(
  backupDir: string,
  snapshot: Snapshot,
  date = new Date(),
): Promise<string> {
  await ensureBackupDir(backupDir);

  const backupId = createBackupId(date, snapshot.guild.id);
  const backupPath = backupPathForId(backupDir, backupId);
  const payload = `${JSON.stringify(snapshot, null, 2)}\n`;

  await writeFile(backupPath, payload, "utf8");

  return backupId;
}

export async function listBackups(backupDir: string): Promise<string[]> {
  await ensureBackupDir(backupDir);

  const entries = await readdir(backupDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(BACKUP_EXTENSION))
    .map((entry) => entry.name)
    .sort()
    .reverse();
}

export async function readSnapshot(backupDir: string, backupId: string): Promise<Snapshot> {
  const backupPath = backupPathForId(backupDir, backupId);
  const payload = await readFile(backupPath, "utf8");

  return validateSnapshot(JSON.parse(payload));
}

export function validateBackupId(backupId: string): string {
  if (!BACKUP_ID_PATTERN.test(backupId)) {
    throw new Error("Invalid backupId. Use an ID returned by discord_backup_create or discord_backup_list.");
  }

  return backupId;
}

function backupPathForId(backupDir: string, backupId: string): string {
  const validBackupId = validateBackupId(backupId);
  const resolvedDir = path.resolve(backupDir);
  const resolvedPath = path.resolve(resolvedDir, validBackupId);

  if (path.dirname(resolvedPath) !== resolvedDir) {
    throw new Error("Invalid backupId path.");
  }

  return resolvedPath;
}

function validateSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid backup snapshot: expected JSON object.");
  }

  const snapshot = value as Partial<Snapshot>;
  if (snapshot.schemaVersion !== schemaVersion) {
    throw new Error(`Unsupported backup schema version: ${String(snapshot.schemaVersion)}`);
  }

  if (!snapshot.guild || typeof snapshot.guild.id !== "string") {
    throw new Error("Invalid backup snapshot: missing guild.id.");
  }

  for (const key of ["roles", "channels", "autoModRules", "scheduledEvents"] as const) {
    if (!Array.isArray(snapshot[key])) {
      throw new Error(`Invalid backup snapshot: ${key} must be an array.`);
    }
  }

  return snapshot as Snapshot;
}
