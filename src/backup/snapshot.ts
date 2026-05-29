import type { Guild } from "discord.js";
import { schemaVersion, type ChannelSnapshot, type JsonValue, type Snapshot, type SnapshotWarning } from "./schema.js";

type AnyRecord = Record<string, unknown>;
type CollectionLike<T> = Iterable<T> | { values(): IterableIterator<T> } | { map<R>(callback: (item: T) => R): R[] };

export async function createSnapshot(guild: Guild, capturedAt = new Date()): Promise<Snapshot> {
  const warnings: SnapshotWarning[] = [];
  const roles = await fetchCollection("roles", guild.roles?.fetch?.bind(guild.roles), warnings);
  const channels = await fetchCollection("channels", guild.channels?.fetch?.bind(guild.channels), warnings);
  const channelKeysById = buildChannelKeysById(channels);
  const roleKeysById = buildRoleKeysById(roles);

  return {
    schemaVersion,
    capturedAt: capturedAt.toISOString(),
    guild: {
      id: guild.id,
      name: guild.name,
      icon: valueOrNull(guild.icon),
      ownerId: valueOrNull(guild.ownerId),
      preferredLocale: valueOrNull(guild.preferredLocale),
      verificationLevel: Number(guild.verificationLevel),
      defaultMessageNotifications: Number(guild.defaultMessageNotifications),
      explicitContentFilter: Number(guild.explicitContentFilter),
      features: [...(guild.features ?? [])].sort(),
    },
    warnings,
    roles: roles.map((role) => ({
      key: roleKey(role),
      id: String(role.id),
      name: String(role.name),
      color: Number(role.color ?? 0),
      hoist: Boolean(role.hoist),
      mentionable: Boolean(role.mentionable),
      permissions: bitfieldString(role.permissions),
      position: Number(role.position ?? 0),
      managed: Boolean(role.managed),
      icon: valueOrNull(role.icon),
      unicodeEmoji: valueOrNull(role.unicodeEmoji),
    })),
    channels: channels.map((channel) => serializeChannel(channel, channelKeysById)),
    autoModRules: (await fetchCollection(
      "autoModRules",
      guild.autoModerationRules?.fetch?.bind(guild.autoModerationRules),
      warnings,
    )).map(
      (rule) => ({
        key: stableKey("automod", rule.name, rule.position, rule.id),
        id: String(rule.id),
        name: String(rule.name),
        enabled: Boolean(rule.enabled),
        eventType: Number(rule.eventType),
        triggerType: Number(rule.triggerType),
        triggerMetadata: toJsonValue(rule.triggerMetadata),
        actions: toJsonArray(rule.actions),
        exemptRoleKeys: idsToKeys(rule.exemptRoles, roleKeysById),
        exemptChannelKeys: idsToKeys(rule.exemptChannels, channelKeysById),
      }),
    ),
    scheduledEvents: (await fetchCollection(
      "scheduledEvents",
      guild.scheduledEvents?.fetch?.bind(guild.scheduledEvents),
      warnings,
    )).map(
      (event) => ({
        key: stableKey("event", event.name, event.scheduledStartTimestamp, event.id),
        id: String(event.id),
        name: String(event.name),
        description: valueOrNull(event.description),
        scheduledStartTime: dateString(event.scheduledStartAt ?? event.scheduledStartTimestamp),
        scheduledEndTime: dateStringOrNull(event.scheduledEndAt ?? event.scheduledEndTimestamp),
        privacyLevel: Number(event.privacyLevel),
        entityType: Number(event.entityType),
        entityMetadata: toJsonValue(event.entityMetadata),
        channelKey: event.channelId ? (channelKeysById.get(String(event.channelId)) ?? null) : null,
        status: Number(event.status),
      }),
    ),
    webhooks: await fetchJsonArray("webhooks", () => guild.fetchWebhooks(), warnings),
    invites: await fetchJsonArray("invites", () => guild.invites.fetch(), warnings),
    emojis: await fetchJsonArray("emojis", () => guild.emojis.fetch(), warnings),
    stickers: await fetchJsonArray("stickers", () => guild.stickers.fetch(), warnings),
    applicationCommands: await fetchJsonArray("applicationCommands", () => guild.commands.fetch(), warnings),
  };
}

function serializeChannel(channel: AnyRecord, channelKeysById: Map<string, string>): ChannelSnapshot {
  const key = channelKey(channel);
  const parentId = typeof channel.parentId === "string" ? channel.parentId : null;

  return {
    key,
    id: String(channel.id),
    name: String(channel.name),
    type: Number(channel.type),
    parentKey: parentId ? (channelKeysById.get(parentId) ?? null) : null,
    position: Number(channel.position ?? channel.rawPosition ?? 0),
    topic: "topic" in channel ? valueOrNull(channel.topic) : undefined,
    nsfw: "nsfw" in channel ? Boolean(channel.nsfw) : undefined,
    rateLimitPerUser: "rateLimitPerUser" in channel ? nullableNumber(channel.rateLimitPerUser) : undefined,
    permissionOverwrites: toArray((channel.permissionOverwrites as { cache?: unknown } | undefined)?.cache)
      .map((overwrite) => ({
        id: String(overwrite.id),
        type: overwriteType(overwrite.type),
        allow: bitfieldString(overwrite.allow),
        deny: bitfieldString(overwrite.deny),
      }))
      .sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`)),
  };
}

function buildRoleKeysById(roles: AnyRecord[]): Map<string, string> {
  return new Map(roles.map((role) => [String(role.id), roleKey(role)]));
}

function buildChannelKeysById(channels: AnyRecord[]): Map<string, string> {
  return new Map(channels.map((channel) => [String(channel.id), channelKey(channel)]));
}

function roleKey(role: AnyRecord): string {
  return stableKey("role", role.name, role.position, role.id);
}

function channelKey(channel: AnyRecord): string {
  const kind = Number(channel.type) === 4 ? "category" : "channel";
  return stableKey(kind, channel.name, channel.position ?? channel.rawPosition, channel.id);
}

function stableKey(kind: string, name: unknown, position: unknown, id: unknown): string {
  return `${kind}:${slug(String(name ?? "unnamed"))}:${Number(position ?? 0)}:${idSuffix(id)}`;
}

function idSuffix(id: unknown): string {
  const value = String(id ?? "unknown");
  return value.length <= 8 ? value : value.slice(-8);
}

function slug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "unnamed";
}

async function fetchCollection(
  section: string,
  fetcher: (() => Promise<unknown>) | undefined,
  warnings: SnapshotWarning[],
): Promise<AnyRecord[]> {
  if (!fetcher) {
    warnings.push({ section, message: "Discord.js fetcher is unavailable for this section." });
    return [];
  }

  try {
    return toArray(await fetcher());
  } catch (error) {
    warnings.push({ section, message: errorMessage(error) });
    return [];
  }
}

async function fetchJsonArray(
  section: string,
  fetcher: () => Promise<unknown>,
  warnings: SnapshotWarning[],
): Promise<JsonValue[]> {
  try {
    return toArray(await fetcher()).map(toJsonValue);
  } catch (error) {
    warnings.push({ section, message: errorMessage(error) });
    return [];
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toArray<T = AnyRecord>(value: unknown): T[] {
  if (!value) {
    return [];
  }

  const collection = value as CollectionLike<T>;

  if (typeof (collection as { values?: unknown }).values === "function") {
    return [...(collection as { values(): IterableIterator<T> }).values()];
  }

  if (typeof (collection as { map?: unknown }).map === "function") {
    return (collection as { map<R>(callback: (item: T) => R): R[] }).map((item) => item);
  }

  if (Symbol.iterator in Object(value)) {
    return [...(value as Iterable<T>)];
  }

  return [];
}

function toJsonArray(value: unknown): JsonValue[] {
  return toArray(value).map(toJsonValue);
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }

  const source =
    typeof (value as { toJSON?: unknown }).toJSON === "function"
      ? ((value as { toJSON(): unknown }).toJSON() as unknown)
      : value;

  if (source !== value) {
    return toJsonValue(source);
  }

  const output: Record<string, JsonValue> = {};
  for (const [key, nested] of Object.entries(source as AnyRecord).sort(([left], [right]) => left.localeCompare(right))) {
    if (isSecretKey(key) || nested === undefined || typeof nested === "function" || typeof nested === "symbol") {
      continue;
    }
    output[key] = toJsonValue(nested);
  }

  return output;
}

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.includes("token") || normalized.includes("secret") || normalized.includes("authorization");
}

function idsToKeys(value: unknown, keysById: Map<string, string>): string[] {
  return toArray(value)
    .map((item) => keysById.get(String(typeof item === "object" && item !== null && "id" in item ? item.id : item)))
    .filter((key): key is string => key !== undefined)
    .sort();
}

function overwriteType(type: unknown): "role" | "member" {
  return type === "role" || type === 0 ? "role" : "member";
}

function bitfieldString(value: unknown): string {
  const bitfield = typeof value === "object" && value !== null && "bitfield" in value ? value.bitfield : value;
  return typeof bitfield === "bigint" ? bitfield.toString() : String(bitfield ?? "0");
}

function dateString(value: unknown): string {
  return dateStringOrNull(value) ?? new Date(0).toISOString();
}

function dateStringOrNull(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "number" || typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}

function valueOrNull(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value);
}

function nullableNumber(value: unknown): number | null {
  return value === undefined || value === null ? null : Number(value);
}
