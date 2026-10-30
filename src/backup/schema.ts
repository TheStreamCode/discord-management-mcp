import { createHash } from "node:crypto";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const schemaVersion = 2 as const;
export const legacySchemaVersion = 1 as const;

export interface ChannelCoverage {
  fetched: number;
  cacheSize: number;
  hiddenKeys: string[];
  complete: boolean;
}

export interface SnapshotCoverage {
  channels: ChannelCoverage;
}

export interface Snapshot {
  schemaVersion: typeof schemaVersion;
  capturedAt: string;
  coverage: SnapshotCoverage;
  guild: GuildSnapshot;
  warnings?: SnapshotWarning[];
  roles: RoleSnapshot[];
  channels: ChannelSnapshot[];
  autoModRules: AutoModRuleSnapshot[];
  scheduledEvents: ScheduledEventSnapshot[];
  webhooks?: JsonValue[];
  invites?: JsonValue[];
  emojis?: JsonValue[];
  stickers?: JsonValue[];
  applicationCommands?: JsonValue[];
}

export interface SnapshotWarning {
  section: string;
  message: string;
}

export interface GuildSnapshot {
  id: string;
  name: string;
  icon: string | null;
  ownerId: string | null;
  preferredLocale: string | null;
  verificationLevel: number;
  defaultMessageNotifications: number;
  explicitContentFilter: number;
  features: string[];
}

export interface RoleColorsSnapshot {
  primary: number | null;
  secondary: number | null;
  tertiary: number | null;
}

export interface RoleSnapshot {
  key: string;
  id: string;
  name: string;
  color: number;
  colors?: RoleColorsSnapshot;
  hoist: boolean;
  mentionable: boolean;
  permissions: string;
  position: number;
  managed: boolean;
  icon?: string | null;
  unicodeEmoji?: string | null;
}

export interface PermissionOverwriteSnapshot {
  id: string;
  type: "role" | "member";
  targetKey?: string;
  allow: string;
  deny: string;
}

export interface ChannelSnapshot {
  key: string;
  id: string;
  name: string;
  type: number;
  parentKey: string | null;
  position: number;
  topic?: string | null;
  nsfw?: boolean;
  rateLimitPerUser?: number | null;
  bitrate?: number | null;
  userLimit?: number | null;
  rtcRegion?: string | null;
  permissionOverwrites: PermissionOverwriteSnapshot[];
}

export interface AutoModRuleSnapshot {
  key: string;
  id: string;
  name: string;
  enabled: boolean;
  eventType: number;
  triggerType: number;
  triggerMetadata: JsonValue;
  actions: JsonValue[];
  exemptRoleKeys: string[];
  exemptChannelKeys: string[];
}

export interface ScheduledEventSnapshot {
  key: string;
  id: string;
  name: string;
  description: string | null;
  scheduledStartTime: string;
  scheduledEndTime: string | null;
  privacyLevel: number;
  entityType: number;
  entityMetadata: JsonValue;
  channelKey: string | null;
  status: number;
}

export interface RestorePlan {
  schemaVersion: typeof schemaVersion;
  sourceBackupId: string;
  targetGuildId: string;
  operations: RestoreOperation[];
  warnings: RestoreWarning[];
  idMap: IdMap;
  planHash: string;
}

export type RestoreResource =
  | "guild"
  | "role"
  | "channel"
  | "permissionOverwrite"
  | "autoModRule"
  | "scheduledEvent";

export type RestorePayload =
  | GuildSnapshot
  | RoleSnapshot
  | ChannelSnapshot
  | PermissionOverwriteSnapshot
  | AutoModRuleSnapshot
  | ScheduledEventSnapshot
  | JsonValue;

export type RestoreOperation =
  | {
      type: "create";
      resource: RestoreResource;
      key: string;
      after: RestorePayload;
    }
  | {
      type: "update";
      resource: RestoreResource;
      key: string;
      before: RestorePayload;
      after: RestorePayload;
      changes: string[];
    }
  | {
      type: "delete";
      resource: RestoreResource;
      key: string;
      before: RestorePayload;
    }
  | {
      type: "skip";
      resource: RestoreResource;
      key: string;
      reason: string;
    };

export interface RestoreWarning {
  code: string;
  message: string;
  resource?: RestoreResource;
  key?: string;
}

export type IdMap = Record<string, string>;

export function emptySnapshotCoverage(): SnapshotCoverage {
  return {
    channels: {
      fetched: 0,
      cacheSize: 0,
      hiddenKeys: [],
      complete: false,
    },
  };
}

export function isSnapshotCoverage(value: unknown): value is SnapshotCoverage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const channels = (value as { channels?: unknown }).channels;
  if (!channels || typeof channels !== "object") {
    return false;
  }

  const candidate = channels as Partial<ChannelCoverage>;
  return (
    typeof candidate.fetched === "number" &&
    typeof candidate.cacheSize === "number" &&
    Array.isArray(candidate.hiddenKeys) &&
    typeof candidate.complete === "boolean"
  );
}

/**
 * Upcasts a parsed legacy (v1) backup payload to the current snapshot shape.
 *
 * The store validates untrusted backup JSON before restore code can use it, so
 * this runs before schema validation: v1 files predate channel coverage and must
 * keep loading with an explicit "coverage unknown" marker instead of failing.
 */
export function upgradeSnapshotPayload(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== legacySchemaVersion) {
    return value;
  }

  return {
    ...candidate,
    schemaVersion,
    coverage: isSnapshotCoverage(candidate.coverage) ? candidate.coverage : emptySnapshotCoverage(),
  };
}

export interface RestorePlanHashInput {
  sourceBackupId: string;
  targetGuildId: string;
  operations: RestoreOperation[];
  warnings: RestoreWarning[];
}

/**
 * Stable sha256 digest of a restore plan. Operators can pass it back to
 * restore apply so a plan reviewed against the live guild cannot silently drift.
 */
export function computeRestorePlanHash(input: RestorePlanHashInput): string {
  const canonical = canonicalJson({
    sourceBackupId: input.sourceBackupId,
    targetGuildId: input.targetGuildId,
    operations: input.operations,
    warnings: input.warnings,
  });

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** JSON serialization with recursively sorted object keys. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : "null";
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);

    return `{${entries.join(",")}}`;
  }

  return "null";
}
