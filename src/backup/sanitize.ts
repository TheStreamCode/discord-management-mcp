import type { JsonValue, Snapshot } from "./schema.js";

const SECRET_FIELD_FRAGMENTS = ["token", "secret", "authorization"] as const;
const INVITE_SECRET_FIELDS = new Set(["code", "url"]);

export function sanitizeSnapshotSecrets(snapshot: Snapshot): Snapshot {
  return {
    ...snapshot,
    autoModRules: snapshot.autoModRules.map((rule) => ({
      ...rule,
      triggerMetadata: sanitizeJsonValue(rule.triggerMetadata),
      actions: rule.actions.map((action) => sanitizeJsonValue(action)),
    })),
    scheduledEvents: snapshot.scheduledEvents.map((event) => ({
      ...event,
      entityMetadata: sanitizeJsonValue(event.entityMetadata),
    })),
    webhooks: snapshot.webhooks?.map((value) => sanitizeJsonValue(value, true)),
    invites: snapshot.invites?.map((value) => sanitizeJsonValue(value, true)),
    emojis: snapshot.emojis?.map((value) => sanitizeJsonValue(value)),
    stickers: snapshot.stickers?.map((value) => sanitizeJsonValue(value)),
    applicationCommands: snapshot.applicationCommands?.map((value) => sanitizeJsonValue(value)),
  };
}

export function sanitizeJsonValue(value: JsonValue, stripInviteFields = false): JsonValue {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeJsonValue(entry, stripInviteFields));
  }

  const sanitized: Record<string, JsonValue> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (isSecretKey(key) || (stripInviteFields && INVITE_SECRET_FIELDS.has(key.toLowerCase()))) {
      continue;
    }
    sanitized[key] = sanitizeJsonValue(nested, stripInviteFields);
  }
  return sanitized;
}

export function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SECRET_FIELD_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}
