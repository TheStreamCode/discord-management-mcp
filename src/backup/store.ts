import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { schemaVersion, type Snapshot } from "./schema.js";
import { sanitizeSnapshotSecrets } from "./sanitize.js";

const BACKUP_EXTENSION = ".json";
const BACKUP_ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[A-Za-z0-9._-]+\.json$/;
const MAX_BACKUP_BYTES = 16 * 1024 * 1024;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_CONTAINER_ITEMS = 10_000;
const MAX_JSON_NODES = 100_000;
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
  permissionOverwrites: z.array(permissionOverwriteSchema).max(1_000),
}).strict();
const snapshotSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
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

export async function ensureBackupDir(backupDir: string): Promise<void> {
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const directoryInfo = await lstat(backupDir);
  if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
    throw new Error("Backup directory must be a real directory, not a symbolic link.");
  }
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

  const safeSnapshot = sanitizeSnapshotSecrets(snapshot);
  const backupId = createBackupId(date, safeSnapshot.guild.id);
  const backupPath = backupPathForId(backupDir, backupId);
  const payload = `${JSON.stringify(safeSnapshot, null, 2)}\n`;

  if (Buffer.byteLength(payload, "utf8") > MAX_BACKUP_BYTES) {
    throw new Error(`Backup snapshot exceeds the ${MAX_BACKUP_BYTES} byte size limit.`);
  }

  await writeFile(backupPath, payload, { encoding: "utf8", flag: "wx", mode: 0o600 });

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
  await ensureBackupDir(backupDir);
  const backupPath = backupPathForId(backupDir, backupId);
  const backupInfo = await lstat(backupPath);
  if (backupInfo.isSymbolicLink() || !backupInfo.isFile()) {
    throw new Error("Backup must be a regular file, not a symbolic link.");
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

  assertJsonShapeLimits(value);

  const parsed = snapshotSchema.safeParse(value);
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
