import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { upgradeSnapshotPayload, type Snapshot } from "./schema.js";
import { sanitizeSnapshotSecrets } from "./sanitize.js";

const BACKUP_EXTENSION = ".json";
const BACKUP_ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[A-Za-z0-9._-]+\.json$/;
const MAX_BACKUP_BYTES = 16 * 1024 * 1024;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_CONTAINER_ITEMS = 10_000;
const MAX_JSON_NODES = 100_000;
const RENAME_RETRY_DELAY_MS = 50;
const boundedString = z.string().max(1_000_000);
const identifierSchema = z.string().min(1).max(255);
const bitfieldSchema = z.string().max(30).regex(/^\d+$/, "expected a non-negative decimal bitfield");
const jsonValueSchema: z.ZodType = z.lazy(() =>
  z.union([
    boundedString,
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema).max(MAX_JSON_CONTAINER_ITEMS),
    z.record(z.string().max(256), jsonValueSchema),
  ]),
);
const permissionOverwriteSchema = z.object({
  id: identifierSchema,
  type: z.enum(["role", "member"]),
  targetKey: identifierSchema.optional(),
  allow: bitfieldSchema,
  deny: bitfieldSchema,
}).strict();
const roleColorsSchema = z.object({
  primary: z.number().int().nullable().optional(),
  secondary: z.number().int().nullable().optional(),
  tertiary: z.number().int().nullable().optional(),
}).strict();
const roleSchema = z.object({
  key: identifierSchema,
  id: identifierSchema,
  name: z.string().max(100),
  color: z.number().int().min(0).max(0xFFFFFF),
  hoist: z.boolean(),
  mentionable: z.boolean(),
  permissions: bitfieldSchema,
  position: z.number().int(),
  managed: z.boolean(),
  icon: z.string().max(255).nullable().optional(),
  unicodeEmoji: z.string().max(32).nullable().optional(),
  colors: roleColorsSchema.optional(),
}).strict();
const channelSchema = z.object({
  key: identifierSchema,
  id: identifierSchema,
  name: z.string().max(100),
  type: z.number().int(),
  parentKey: identifierSchema.nullable(),
  position: z.number().int(),
  topic: z.string().max(4096).nullable().optional(),
  nsfw: z.boolean().optional(),
  rateLimitPerUser: z.number().int().nullable().optional(),
  bitrate: z.number().int().nullable().optional(),
  userLimit: z.number().int().nullable().optional(),
  rtcRegion: z.string().max(100).nullable().optional(),
  permissionOverwrites: z.array(permissionOverwriteSchema).max(1_000),
}).strict();
const coverageSchema = z.object({
  channels: z.object({
    fetched: z.number().int().min(0),
    cacheSize: z.number().int().min(0),
    hiddenKeys: z.array(identifierSchema).max(500),
    complete: z.boolean(),
  }).strict(),
}).strict();
const snapshotSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  capturedAt: z.string().datetime(),
  guild: z.object({
    id: identifierSchema,
    name: z.string().max(100),
    icon: z.string().max(255).nullable(),
    ownerId: identifierSchema.nullable(),
    preferredLocale: z.string().max(32).nullable(),
    verificationLevel: z.number().int(),
    defaultMessageNotifications: z.number().int(),
    explicitContentFilter: z.number().int(),
    features: z.array(z.string().max(100)).max(500),
  }).strict(),
  warnings: z.array(z.object({
    section: z.string().min(1).max(100),
    message: z.string().max(1_024),
  }).strict()).max(100).optional(),
  coverage: coverageSchema.optional(),
  roles: z.array(roleSchema).max(250),
  channels: z.array(channelSchema).max(500),
  autoModRules: z.array(z.object({
    key: identifierSchema,
    id: identifierSchema,
    name: z.string().max(100),
    enabled: z.boolean(),
    eventType: z.number().int(),
    triggerType: z.number().int(),
    triggerMetadata: jsonValueSchema,
    actions: z.array(jsonValueSchema).max(20),
    exemptRoleKeys: z.array(identifierSchema).max(250),
    exemptChannelKeys: z.array(identifierSchema).max(500),
  }).strict()).max(100),
  scheduledEvents: z.array(z.object({
    key: identifierSchema,
    id: identifierSchema,
    name: z.string().max(100),
    description: z.string().max(1_000).nullable(),
    scheduledStartTime: z.string().datetime(),
    scheduledEndTime: z.string().datetime().nullable(),
    privacyLevel: z.number().int(),
    entityType: z.number().int(),
    entityMetadata: jsonValueSchema,
    channelKey: identifierSchema.nullable(),
    status: z.number().int(),
  }).strict()).max(1_000),
  webhooks: z.array(jsonValueSchema).max(MAX_JSON_CONTAINER_ITEMS).optional(),
  invites: z.array(jsonValueSchema).max(MAX_JSON_CONTAINER_ITEMS).optional(),
  emojis: z.array(jsonValueSchema).max(MAX_JSON_CONTAINER_ITEMS).optional(),
  stickers: z.array(jsonValueSchema).max(MAX_JSON_CONTAINER_ITEMS).optional(),
  applicationCommands: z.array(jsonValueSchema).max(MAX_JSON_CONTAINER_ITEMS).optional(),
}).strict();

/**
 * Returns whether the backup directory exists and is a real directory.
 * Read-only tools use this instead of creating directories as a side effect.
 */
export async function backupDirectoryExists(backupDir: string): Promise<boolean> {
  const info = await lstatIfExists(backupDir);

  if (!info) {
    return false;
  }

  if (info.isSymbolicLink()) {
    throw new Error("Backup directory must be a real directory, not a symbolic link or junction.");
  }

  return info.isDirectory();
}

export function createBackupId(date: Date, guildId: string): string {
  const timestamp = date.toISOString().replace(/[:.]/g, "-");
  const safeGuildId = guildId.replace(/[^A-Za-z0-9._-]/g, "_");

  return `${timestamp}-${safeGuildId}${BACKUP_EXTENSION}`;
}

/**
 * Writes a backup atomically: the payload is flushed to a temporary file in the
 * destination directory, fsynced, then renamed over the final name. A crash
 * leaves at most a *.tmp file behind, never a truncated backup that later reads
 * would treat as valid.
 */
export async function writeSnapshot(
  backupDir: string,
  snapshot: Snapshot,
  date = new Date(),
): Promise<string> {
  await ensureBackupDirForWrite(backupDir);

  const safeSnapshot = sanitizeSnapshotSecrets(snapshot);
  const backupId = createBackupId(date, safeSnapshot.guild.id);
  const backupPath = backupPathForId(backupDir, backupId);
  const payload = `${JSON.stringify(safeSnapshot, null, 2)}\n`;

  if (Buffer.byteLength(payload, "utf8") > MAX_BACKUP_BYTES) {
    throw new Error(`Backup snapshot exceeds the ${MAX_BACKUP_BYTES} byte size limit.`);
  }

  await assertBackupDoesNotExist(backupPath);

  const tempPath = path.join(path.dirname(backupPath), `${backupId}.${process.pid}.${randomUUID()}.tmp`);

  try {
    await writeAndSyncTempFile(tempPath, payload);
    await renameWithRetry(tempPath, backupPath);
  } catch (error) {
    await removeFileIfExists(tempPath);
    throw error;
  }

  try {
    // Never report a backup as created unless the persisted file validates.
    await verifyWrittenBackup(backupPath);
  } catch (error) {
    await removeFileIfExists(backupPath);
    throw error;
  }

  return backupId;
}

/**
 * Lists stored backup IDs, newest first. It never creates the backup directory:
 * a missing directory simply means there are no backups yet.
 */
export async function listBackups(backupDir: string): Promise<string[]> {
  let entries;

  try {
    entries = await readdir(backupDir, { withFileTypes: true });
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }

  return entries
    .filter((entry) => entry.isFile() && BACKUP_ID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
}

export async function readSnapshot(backupDir: string, backupId: string): Promise<Snapshot> {
  // Validate the request before touching the filesystem: an invalid backup id is
  // a caller error regardless of whether the directory exists yet.
  const backupPath = backupPathForId(backupDir, backupId);

  if (!(await backupDirectoryExists(backupDir))) {
    throw new Error(
      `Backup directory does not exist: ${backupDir}. Create a backup with discord_backup_create or check BACKUP_DIR.`,
    );
  }

  const backupInfo = await lstatIfExists(backupPath);

  if (!backupInfo) {
    throw new Error(`Backup not found: ${backupId}. List backups with discord_backup_list.`);
  }

  if (isReparsePoint(backupInfo) || !backupInfo.isFile()) {
    throw new Error("Backup must be a regular file, not a symbolic link, junction, or reparse point.");
  }

  if (backupInfo.size > MAX_BACKUP_BYTES) {
    throw new Error(`Backup snapshot exceeds the ${MAX_BACKUP_BYTES} byte size limit.`);
  }

  const payload = await readFile(backupPath, "utf8");

  return validateSnapshot(JSON.parse(payload));
}

export function validateBackupId(backupId: string): string {
  if (!BACKUP_ID_PATTERN.test(backupId)) {
    throw new Error("Invalid backupId. Use an ID returned by discord_backup_create or discord_backup_list.");
  }

  return backupId;
}

async function ensureBackupDirForWrite(backupDir: string): Promise<void> {
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const directoryInfo = await lstat(backupDir);

  if (isReparsePoint(directoryInfo) || !directoryInfo.isDirectory()) {
    throw new Error("Backup directory must be a real directory, not a symbolic link or junction.");
  }
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

async function assertBackupDoesNotExist(backupPath: string): Promise<void> {
  const existing = await lstatIfExists(backupPath);

  if (existing) {
    throw createErrnoError(
      "EEXIST",
      `Backup ${path.basename(backupPath)} already exists; refusing to overwrite it. Retry to create a new snapshot.`,
    );
  }
}

async function writeAndSyncTempFile(tempPath: string, payload: string): Promise<void> {
  let handle: FileHandle | undefined;

  try {
    handle = await open(tempPath, "wx", 0o600);
    await handle.writeFile(payload, "utf8");
    await handle.sync();
  } catch (error) {
    await handle?.close().catch(() => undefined);
    handle = undefined;
    await removeFileIfExists(tempPath);
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * On Windows a concurrent scanner or indexer can briefly hold the destination
 * and make rename fail with EPERM/EEXIST even when the move itself is legal.
 * One retry after a short delay removes the transient failure without hiding a
 * persistent one.
 */
async function renameWithRetry(tempPath: string, backupPath: string): Promise<void> {
  try {
    await rename(tempPath, backupPath);
  } catch (error) {
    if (process.platform !== "win32" || !isTransientRenameError(error)) {
      throw error;
    }

    await delay(RENAME_RETRY_DELAY_MS);
    await rename(tempPath, backupPath);
  }
}

async function verifyWrittenBackup(backupPath: string): Promise<void> {
  const backupInfo = await lstat(backupPath);

  if (isReparsePoint(backupInfo) || !backupInfo.isFile()) {
    throw new Error("Backup write failed: the destination is not a regular file.");
  }

  if (backupInfo.size > MAX_BACKUP_BYTES) {
    throw new Error(`Backup snapshot exceeds the ${MAX_BACKUP_BYTES} byte size limit.`);
  }

  const payload = await readFile(backupPath, "utf8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("Backup write failed: the persisted file is not valid JSON.");
  }

  validateSnapshot(parsed);
}

function validateSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid backup snapshot: expected JSON object.");
  }

  const rawVersion = (value as { schemaVersion?: unknown }).schemaVersion;
  if (rawVersion !== 1 && rawVersion !== 2) {
    throw new Error(`Unsupported backup schema version: ${String(rawVersion)}`);
  }

  // v1 payloads are upcast before validation so missing v2 fields are not
  // reported as corruption. The upcaster is owned by the schema module.
  const upgraded = upgradeSnapshotPayload(value);

  assertJsonShapeLimits(upgraded);

  const parsed = snapshotSchema.safeParse(upgraded);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const location = issue?.path.length ? issue.path.join(".") : "root";
    throw new Error(`Invalid backup snapshot at ${location}: ${issue?.message ?? "validation failed"}`);
  }

  return sanitizeSnapshotSecrets(parsed.data as Snapshot);
}

function assertJsonShapeLimits(value: unknown): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;

  while (pending.length > 0) {
    const current = pending.pop()!;
    nodes += 1;
    if (nodes > MAX_JSON_NODES) {
      throw new Error(`Invalid backup snapshot: exceeds ${MAX_JSON_NODES} JSON nodes.`);
    }
    if (current.depth > MAX_JSON_DEPTH) {
      throw new Error(`Invalid backup snapshot: exceeds JSON depth ${MAX_JSON_DEPTH}.`);
    }
    if (!current.value || typeof current.value !== "object") {
      continue;
    }

    const entries = Array.isArray(current.value)
      ? current.value.map((entry) => ["", entry] as const)
      : Object.entries(current.value);
    if (entries.length > MAX_JSON_CONTAINER_ITEMS) {
      throw new Error(`Invalid backup snapshot: a JSON container exceeds ${MAX_JSON_CONTAINER_ITEMS} items.`);
    }
    for (const [, nested] of entries) {
      pending.push({ value: nested, depth: current.depth + 1 });
    }
  }
}

async function lstatIfExists(target: string) {
  try {
    return await lstat(target);
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
}

async function removeFileIfExists(target: string): Promise<void> {
  try {
    await unlink(target);
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) {
      return;
    }
    // Best-effort cleanup: a failed unlink must not mask the original error.
  }
}

function isReparsePoint(info: { isSymbolicLink(): boolean }): boolean {
  return info.isSymbolicLink();
}

function isErrnoCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function isTransientRenameError(error: unknown): boolean {
  return isErrnoCode(error, "EPERM") || isErrnoCode(error, "EEXIST");
}

function createErrnoError(code: string, message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
