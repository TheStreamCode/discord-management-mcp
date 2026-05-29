import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  type AutoModerationActionOptions,
  type AutoModerationRuleCreateOptions,
  type AutoModerationRuleEditOptions,
  type GuildScheduledEventCreateOptions,
} from "discord.js";
import { z } from "zod";
import type { ServerConfig } from "../config.js";
import type { DiscordClientManager } from "../discordClient.js";
import { errorResponse, successResponse } from "../responses.js";
import { requireConfirmation, requireDestructiveBackupForGuild } from "../safety.js";

const optionalReason = z.string().min(1).max(512).optional();
const snowflake = z.string().min(1);
const jsonObject = z.record(z.string(), z.unknown());
const enumInput = z.union([z.string(), z.number()]);

type EnumLike = Record<string, string | number>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function enumValue<T extends string | number>(value: string | number, values: EnumLike, field: string): T {
  if (typeof value === "number") {
    return value as T;
  }

  if (value in values) {
    return values[value] as T;
  }

  const numeric = Number(value);
  if (Number.isInteger(numeric)) {
    return numeric as T;
  }

  throw new Error(`Invalid ${field}: ${value}`);
}

function normalizeAutoModActions(actions: unknown[]): AutoModerationActionOptions[] {
  return actions.map((action, index) => {
    if (!action || typeof action !== "object") {
      throw new Error(`actions[${index}] must be an object.`);
    }

    const raw = { ...(action as Record<string, unknown>) };
    const type = raw.type;
    if (typeof type !== "string" && typeof type !== "number") {
      throw new Error(`actions[${index}].type is required.`);
    }

    const metadata = raw.metadata && typeof raw.metadata === "object"
      ? { ...(raw.metadata as Record<string, unknown>) }
      : undefined;

    if (metadata && "channelId" in metadata && !("channel" in metadata)) {
      metadata.channel = metadata.channelId;
      delete metadata.channelId;
    }

    return {
      type: enumValue<AutoModerationActionType>(type, AutoModerationActionType, `actions[${index}].type`),
      ...(metadata ? { metadata } : {}),
    } as AutoModerationActionOptions;
  });
}

function normalizeAutoModCreate(input: {
  name: string;
  eventType: string | number;
  triggerType: string | number;
  triggerMetadata?: Record<string, unknown>;
  actions: unknown[];
  enabled?: boolean;
  exemptRoleIds?: string[];
  exemptChannelIds?: string[];
  reason?: string;
}): AutoModerationRuleCreateOptions {
  return {
    name: input.name,
    eventType: enumValue<AutoModerationRuleEventType>(input.eventType, AutoModerationRuleEventType, "eventType"),
    triggerType: enumValue<AutoModerationRuleTriggerType>(input.triggerType, AutoModerationRuleTriggerType, "triggerType"),
    triggerMetadata: input.triggerMetadata,
    actions: normalizeAutoModActions(input.actions),
    enabled: input.enabled,
    exemptRoles: input.exemptRoleIds,
    exemptChannels: input.exemptChannelIds,
    reason: input.reason,
  };
}

function normalizeAutoModEdit(input: {
  name?: string;
  eventType?: string | number;
  triggerMetadata?: Record<string, unknown>;
  actions?: unknown[];
  enabled?: boolean;
  exemptRoleIds?: string[];
  exemptChannelIds?: string[];
  reason?: string;
}): AutoModerationRuleEditOptions {
  return {
    name: input.name,
    eventType: input.eventType === undefined
      ? undefined
      : enumValue<AutoModerationRuleEventType>(input.eventType, AutoModerationRuleEventType, "eventType"),
    triggerMetadata: input.triggerMetadata,
    actions: input.actions ? normalizeAutoModActions(input.actions) : undefined,
    enabled: input.enabled,
    exemptRoles: input.exemptRoleIds,
    exemptChannels: input.exemptChannelIds,
    reason: input.reason,
  };
}

function normalizeScheduledEventCreate(input: {
  name: string;
  scheduledStartTime: string;
  scheduledEndTime?: string;
  privacyLevel?: string | number;
  entityType: string | number;
  description?: string;
  channelId?: string;
  location?: string;
  entityMetadata?: Record<string, unknown>;
  image?: string;
  reason?: string;
}): GuildScheduledEventCreateOptions {
  const entityMetadata = { ...(input.entityMetadata ?? {}) };
  if (input.location && !("location" in entityMetadata)) {
    entityMetadata.location = input.location;
  }

  return {
    name: input.name,
    scheduledStartTime: input.scheduledStartTime,
    scheduledEndTime: input.scheduledEndTime,
    privacyLevel: input.privacyLevel === undefined
      ? GuildScheduledEventPrivacyLevel.GuildOnly
      : enumValue<GuildScheduledEventPrivacyLevel>(input.privacyLevel, GuildScheduledEventPrivacyLevel, "privacyLevel"),
    entityType: enumValue<GuildScheduledEventEntityType>(input.entityType, GuildScheduledEventEntityType, "entityType"),
    description: input.description,
    channel: input.channelId,
    entityMetadata: Object.keys(entityMetadata).length > 0 ? entityMetadata : undefined,
    image: input.image,
    reason: input.reason,
  } as GuildScheduledEventCreateOptions;
}

function normalizeScheduledEventEdit(input: {
  name?: string;
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  privacyLevel?: string | number;
  entityType?: string | number;
  status?: string | number;
  description?: string | null;
  channelId?: string | null;
  location?: string;
  entityMetadata?: Record<string, unknown>;
  image?: string | null;
  reason?: string;
}): Record<string, unknown> {
  const entityMetadata = { ...(input.entityMetadata ?? {}) };
  if (input.location && !("location" in entityMetadata)) {
    entityMetadata.location = input.location;
  }

  return {
    name: input.name,
    scheduledStartTime: input.scheduledStartTime,
    scheduledEndTime: input.scheduledEndTime,
    privacyLevel: input.privacyLevel === undefined
      ? undefined
      : enumValue<GuildScheduledEventPrivacyLevel>(input.privacyLevel, GuildScheduledEventPrivacyLevel, "privacyLevel"),
    entityType: input.entityType === undefined
      ? undefined
      : enumValue<GuildScheduledEventEntityType>(input.entityType, GuildScheduledEventEntityType, "entityType"),
    status: input.status === undefined
      ? undefined
      : enumValue<GuildScheduledEventStatus>(input.status, GuildScheduledEventStatus, "status"),
    description: input.description,
    channel: input.channelId,
    entityMetadata: Object.keys(entityMetadata).length > 0 ? entityMetadata : undefined,
    image: input.image,
    reason: input.reason,
  };
}

export function registerModerationTools(
  server: McpServer,
  discord: DiscordClientManager,
  config: ServerConfig,
): void {
  server.registerTool(
    "discord_timeout_member",
    {
      title: "Timeout Discord member",
      description: "Timeout a guild member for the requested duration in seconds.",
      inputSchema: {
        guildId: snowflake,
        userId: snowflake,
        durationSeconds: z.number().int().min(0).max(2_419_200),
        confirm: z.boolean().optional(),
        reason: optionalReason,
      },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        const guild = await discord.getGuild(input.guildId);
        const member = await guild.members.fetch(input.userId);
        const timeoutMs = input.durationSeconds === 0 ? null : input.durationSeconds * 1000;
        const updated = await member.timeout(timeoutMs, input.reason);
        return successResponse("Member timeout updated.", {
          guildId: guild.id,
          userId: updated.id,
          timeoutUntil: updated.communicationDisabledUntil?.toISOString() ?? null,
        });
      } catch (error) {
        return errorResponse("Failed to timeout member.", { error: errorMessage(error) });
      }
    },
  );

  server.registerTool(
    "discord_kick_member",
    {
      title: "Kick Discord member",
      description: "Kick a guild member. Requires confirmation and either a backupId or allowWithoutBackup.",
      inputSchema: {
        guildId: snowflake,
        userId: snowflake,
        confirm: z.boolean().optional(),
        reason: optionalReason,
        backupId: z.string().optional(),
        allowWithoutBackup: z.boolean().optional(),
      },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        await requireDestructiveBackupForGuild(input, config.backupDir, input.guildId);
        const guild = await discord.getGuild(input.guildId);
        const member = await guild.members.fetch(input.userId);
        await member.kick(input.reason);
        return successResponse("Member kicked.", { guildId: guild.id, userId: input.userId });
      } catch (error) {
        return errorResponse("Failed to kick member.", { error: errorMessage(error) });
      }
    },
  );

  server.registerTool(
    "discord_ban_member",
    {
      title: "Ban Discord member",
      description: "Ban a guild member. Requires confirmation and either a backupId or allowWithoutBackup.",
      inputSchema: {
        guildId: snowflake,
        userId: snowflake,
        deleteMessageSeconds: z.number().int().min(0).max(604_800).optional(),
        confirm: z.boolean().optional(),
        reason: optionalReason,
        backupId: z.string().optional(),
        allowWithoutBackup: z.boolean().optional(),
      },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        await requireDestructiveBackupForGuild(input, config.backupDir, input.guildId);
        const guild = await discord.getGuild(input.guildId);
        await guild.members.ban(input.userId, {
          deleteMessageSeconds: input.deleteMessageSeconds,
          reason: input.reason,
        });
        return successResponse("Member banned.", {
          guildId: guild.id,
          userId: input.userId,
          deleteMessageSeconds: input.deleteMessageSeconds ?? 0,
        });
      } catch (error) {
        return errorResponse("Failed to ban member.", { error: errorMessage(error) });
      }
    },
  );

  server.registerTool(
    "discord_unban_member",
    {
      title: "Unban Discord member",
      description: "Remove a guild ban for a user.",
      inputSchema: {
        guildId: snowflake,
        userId: snowflake,
        confirm: z.boolean().optional(),
        reason: optionalReason,
      },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        const guild = await discord.getGuild(input.guildId);
        await guild.members.unban(input.userId, input.reason);
        return successResponse("Member unbanned.", { guildId: guild.id, userId: input.userId });
      } catch (error) {
        return errorResponse("Failed to unban member.", { error: errorMessage(error) });
      }
    },
  );

  server.registerTool(
    "discord_bulk_delete_messages",
    {
      title: "Bulk delete Discord messages",
      description: "Bulk delete messages by count or explicit message IDs. Requires confirmation and backup acknowledgement.",
      inputSchema: {
        channelId: snowflake,
        limit: z.number().int().min(1).max(100).optional(),
        messageIds: z.array(snowflake).min(1).max(100).optional(),
        confirm: z.boolean().optional(),
        reason: optionalReason,
        backupId: z.string().optional(),
        allowWithoutBackup: z.boolean().optional(),
      },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        if (!input.limit && !input.messageIds) {
          throw new Error("Either limit or messageIds is required.");
        }

        const client = await discord.getClient();
        const channel = await client.channels.fetch(input.channelId);
        if (!channel || !("bulkDelete" in channel) || typeof channel.bulkDelete !== "function") {
          throw new Error(`Channel does not support bulk deletion: ${input.channelId}`);
        }
        if (!("guildId" in channel) || typeof channel.guildId !== "string") {
          throw new Error(`Channel is not a guild channel: ${input.channelId}`);
        }
        await requireDestructiveBackupForGuild(input, config.backupDir, channel.guildId);

        const deleteTarget = input.messageIds ?? input.limit;
        if (!deleteTarget) {
          throw new Error("Either limit or messageIds is required.");
        }

        const deleted = await channel.bulkDelete(deleteTarget, true);
        return successResponse("Messages bulk deleted.", {
          channelId: input.channelId,
          deletedCount: deleted.size,
          requestedCount: input.messageIds?.length ?? input.limit ?? 0,
          reason: input.reason ?? null,
        });
      } catch (error) {
        return errorResponse("Failed to bulk delete messages.", { error: errorMessage(error) });
      }
    },
  );

  server.registerTool(
    "discord_create_automod_rule",
    {
      title: "Create Discord AutoMod rule",
      description: "Create a Discord AutoMod rule with JSON trigger metadata and actions.",
      inputSchema: {
        guildId: snowflake,
        name: z.string().min(1).max(100),
        eventType: enumInput,
        triggerType: enumInput,
        triggerMetadata: jsonObject.optional(),
        actions: z.array(jsonObject).min(1),
        enabled: z.boolean().optional(),
        exemptRoleIds: z.array(snowflake).optional(),
        exemptChannelIds: z.array(snowflake).optional(),
        confirm: z.boolean().optional(),
        reason: optionalReason,
      },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        const guild = await discord.getGuild(input.guildId);
        const rule = await guild.autoModerationRules.create(normalizeAutoModCreate(input));
        return successResponse("AutoMod rule created.", {
          guildId: guild.id,
          ruleId: rule.id,
          name: rule.name,
          enabled: rule.enabled,
        });
      } catch (error) {
        return errorResponse("Failed to create AutoMod rule.", { error: errorMessage(error) });
      }
    },
  );

  server.registerTool(
    "discord_update_automod_rule",
    {
      title: "Update Discord AutoMod rule",
      description: "Update a Discord AutoMod rule with JSON trigger metadata and actions.",
      inputSchema: {
        guildId: snowflake,
        ruleId: snowflake,
        name: z.string().min(1).max(100).optional(),
        eventType: enumInput.optional(),
        triggerMetadata: jsonObject.optional(),
        actions: z.array(jsonObject).min(1).optional(),
        enabled: z.boolean().optional(),
        exemptRoleIds: z.array(snowflake).optional(),
        exemptChannelIds: z.array(snowflake).optional(),
        confirm: z.boolean().optional(),
        reason: optionalReason,
      },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        const guild = await discord.getGuild(input.guildId);
        const rule = await guild.autoModerationRules.fetch(input.ruleId);
        if (!rule) {
          throw new Error(`AutoMod rule not found: ${input.ruleId}`);
        }

        const updated = await rule.edit(normalizeAutoModEdit(input));
        return successResponse("AutoMod rule updated.", {
          guildId: guild.id,
          ruleId: updated.id,
          name: updated.name,
          enabled: updated.enabled,
        });
      } catch (error) {
        return errorResponse("Failed to update AutoMod rule.", { error: errorMessage(error) });
      }
    },
  );

  server.registerTool(
    "discord_delete_automod_rule",
    {
      title: "Delete Discord AutoMod rule",
      description: "Delete a Discord AutoMod rule.",
      inputSchema: {
        guildId: snowflake,
        ruleId: snowflake,
        confirm: z.boolean().optional(),
        reason: optionalReason,
        backupId: z.string().optional(),
        allowWithoutBackup: z.boolean().optional(),
      },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        await requireDestructiveBackupForGuild(input, config.backupDir, input.guildId);
        const guild = await discord.getGuild(input.guildId);
        const rule = await guild.autoModerationRules.fetch(input.ruleId);
        if (!rule) {
          throw new Error(`AutoMod rule not found: ${input.ruleId}`);
        }

        await rule.delete(input.reason);
        return successResponse("AutoMod rule deleted.", { guildId: guild.id, ruleId: input.ruleId });
      } catch (error) {
        return errorResponse("Failed to delete AutoMod rule.", { error: errorMessage(error) });
      }
    },
  );

  server.registerTool(
    "discord_create_scheduled_event",
    {
      title: "Create Discord scheduled event",
      description: "Create a Discord scheduled event. Use channelId for voice/stage events or location for external events.",
      inputSchema: {
        guildId: snowflake,
        name: z.string().min(1).max(100),
        scheduledStartTime: z.string().datetime(),
        scheduledEndTime: z.string().datetime().optional(),
        privacyLevel: enumInput.optional(),
        entityType: enumInput,
        description: z.string().max(1_000).optional(),
        channelId: snowflake.optional(),
        location: z.string().min(1).max(100).optional(),
        entityMetadata: jsonObject.optional(),
        image: z.string().optional(),
        confirm: z.boolean().optional(),
        reason: optionalReason,
      },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        const guild = await discord.getGuild(input.guildId);
        const event = await guild.scheduledEvents.create(normalizeScheduledEventCreate(input));
        return successResponse("Scheduled event created.", {
          guildId: guild.id,
          eventId: event.id,
          name: event.name,
          status: event.status,
        });
      } catch (error) {
        return errorResponse("Failed to create scheduled event.", { error: errorMessage(error) });
      }
    },
  );

  server.registerTool(
    "discord_update_scheduled_event",
    {
      title: "Update Discord scheduled event",
      description: "Update a Discord scheduled event.",
      inputSchema: {
        guildId: snowflake,
        eventId: snowflake,
        name: z.string().min(1).max(100).optional(),
        scheduledStartTime: z.string().datetime().optional(),
        scheduledEndTime: z.string().datetime().optional(),
        privacyLevel: enumInput.optional(),
        entityType: enumInput.optional(),
        status: enumInput.optional(),
        description: z.string().max(1_000).nullable().optional(),
        channelId: snowflake.nullable().optional(),
        location: z.string().min(1).max(100).optional(),
        entityMetadata: jsonObject.optional(),
        image: z.string().nullable().optional(),
        confirm: z.boolean().optional(),
        reason: optionalReason,
      },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        const guild = await discord.getGuild(input.guildId);
        const event = await guild.scheduledEvents.fetch(input.eventId);
        if (!event) {
          throw new Error(`Scheduled event not found: ${input.eventId}`);
        }

        const updated = await event.edit(normalizeScheduledEventEdit(input) as Parameters<typeof event.edit>[0]);
        return successResponse("Scheduled event updated.", {
          guildId: guild.id,
          eventId: updated.id,
          name: updated.name,
          status: updated.status,
        });
      } catch (error) {
        return errorResponse("Failed to update scheduled event.", { error: errorMessage(error) });
      }
    },
  );

  server.registerTool(
    "discord_delete_scheduled_event",
    {
      title: "Delete Discord scheduled event",
      description: "Delete a Discord scheduled event.",
      inputSchema: {
        guildId: snowflake,
        eventId: snowflake,
        confirm: z.boolean().optional(),
        reason: optionalReason,
        backupId: z.string().optional(),
        allowWithoutBackup: z.boolean().optional(),
      },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        await requireDestructiveBackupForGuild(input, config.backupDir, input.guildId);
        const guild = await discord.getGuild(input.guildId);
        const event = await guild.scheduledEvents.fetch(input.eventId);
        if (!event) {
          throw new Error(`Scheduled event not found: ${input.eventId}`);
        }

        await event.delete();
        return successResponse("Scheduled event deleted.", { guildId: guild.id, eventId: input.eventId });
      } catch (error) {
        return errorResponse("Failed to delete scheduled event.", { error: errorMessage(error) });
      }
    },
  );
}
