export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const schemaVersion = 1 as const;

export interface Snapshot {
  schemaVersion: typeof schemaVersion;
  capturedAt: string;
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

export interface RoleSnapshot {
  key: string;
  id: string;
  name: string;
  color: number;
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
