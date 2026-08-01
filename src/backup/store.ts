import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { schemaVersion, type Snapshot } from "./schema.js";

const BACKUP_EXTENSION = ".json";
const BACKUP_ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[A-Za-z0-9._-]+\.json$/;
const bitfieldSchema = z.string().regex(/^\d+$/, "expected a non-negative decimal bitfield");
const jsonValueSchema: z.ZodType = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
const permissionOverwriteSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["role", "member"]),
  targetKey: z.string().min(1).optional(),
  allow: bitfieldSchema,
  deny: bitfieldSchema,
}).strict();
const roleSchema = z.object({
  key: z.string().min(1),
  id: z.string().min(1),
  name: z.string(),
  color: z.number().int().min(0),
  hoist: z.boolean(),
  mentionable: z.boolean(),
  permissions: bitfieldSchema,
  position: z.number().int(),
  managed: z.boolean(),
  icon: z.string().nullable().optional(),
  unicodeEmoji: z.string().nullable().optional(),
}).strict();
const channelSchema = z.object({
  key: z.string().min(1),
  id: z.string().min(1),
  name: z.string(),
  type: z.number().int(),
  parentKey: z.string().nullable(),
  position: z.number().int(),
  topic: z.string().nullable().optional(),
  nsfw: z.boolean().optional(),
  rateLimitPerUser: z.number().int().nullable().optional(),
  permissionOverwrites: z.array(permissionOverwriteSchema),
}).strict();
const snapshotSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  capturedAt: z.string().datetime(),
  guild: z.object({
    id: z.string().min(1),
    name: z.string(),
    icon: z.string().nullable(),
    ownerId: z.string().nullable(),
    preferredLocale: z.string().nullable(),
    verificationLevel: z.number().int(),
    defaultMessageNotifications: z.number().int(),
    explicitContentFilter: z.number().int(),
    features: z.array(z.string()),
  }).strict(),
  warnings: z.array(z.object({
    section: z.string().min(1),
    message: z.string(),
  }).strict()).optional(),
  roles: z.array(roleSchema),
  channels: z.array(channelSchema),
  autoModRules: z.array(z.object({
    key: z.string().min(1),
    id: z.string().min(1),
    name: z.string(),
    enabled: z.boolean(),
    eventType: z.number().int(),
    triggerType: z.number().int(),
    triggerMetadata: jsonValueSchema,
    actions: z.array(jsonValueSchema),
    exemptRoleKeys: z.array(z.string()),
    exemptChannelKeys: z.array(z.string()),
  }).strict()),
  scheduledEvents: z.array(z.object({
    key: z.string().min(1),
    id: z.string().min(1),
    name: z.string(),
    description: z.string().nullable(),
    scheduledStartTime: z.string().datetime(),
    scheduledEndTime: z.string().datetime().nullable(),
    privacyLevel: z.number().int(),
    entityType: z.number().int(),
    entityMetadata: jsonValueSchema,
    channelKey: z.string().nullable(),
    status: z.number().int(),
  }).strict()),
  webhooks: z.array(jsonValueSchema).optional(),
  invites: z.array(jsonValueSchema).optional(),
  emojis: z.array(jsonValueSchema).optional(),
  stickers: z.array(jsonValueSchema).optional(),
  applicationCommands: z.array(jsonValueSchema).optional(),
}).strict();

export async function ensureBackupDir(backupDir: string): Promise<void> {
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
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

  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const location = issue?.path.length ? issue.path.join(".") : "root";
    throw new Error(`Invalid backup snapshot at ${location}: ${issue?.message ?? "validation failed"}`);
  }

  return parsed.data as Snapshot;
}
