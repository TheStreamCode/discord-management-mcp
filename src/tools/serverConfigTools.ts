import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  GuildDefaultMessageNotifications,
  GuildExplicitContentFilter,
  GuildVerificationLevel,
  type GuildEditOptions,
} from "discord.js";
import { z } from "zod";
import type { ServerConfig } from "../config.js";
import type { DiscordClientManager } from "../discordClient.js";
import { errorResponse, successResponse } from "../responses.js";
import { requireConfirmation, requireDestructiveBackupForGuild } from "../safety.js";

const optionalReason = z.string().min(1).max(512).optional();
const snowflake = z.string().min(1);
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

function guildEditOptions(input: {
  name?: string;
  description?: string | null;
  verificationLevel?: string | number;
  explicitContentFilter?: string | number;
  defaultMessageNotifications?: string | number;
  preferredLocale?: string;
  afkTimeout?: number;
  reason?: string;
}): GuildEditOptions {
  return {
    name: input.name,
    description: input.description,
    verificationLevel: input.verificationLevel === undefined
      ? undefined
      : enumValue<GuildVerificationLevel>(input.verificationLevel, GuildVerificationLevel, "verificationLevel"),
    explicitContentFilter: input.explicitContentFilter === undefined
      ? undefined
      : enumValue<GuildExplicitContentFilter>(
        input.explicitContentFilter,
        GuildExplicitContentFilter,
        "explicitContentFilter",
      ),
    defaultMessageNotifications: input.defaultMessageNotifications === undefined
      ? undefined
      : enumValue<GuildDefaultMessageNotifications>(
        input.defaultMessageNotifications,
        GuildDefaultMessageNotifications,
        "defaultMessageNotifications",
      ),
    preferredLocale: input.preferredLocale as GuildEditOptions["preferredLocale"],
    afkTimeout: input.afkTimeout,
    reason: input.reason,
  };
}

export function registerServerConfigTools(
  server: McpServer,
  discord: DiscordClientManager,
  config: ServerConfig,
): void {
  server.registerTool(
    "discord_update_guild_settings",
    {
      title: "Update Discord guild settings",
      description: "Update basic guild settings such as name, description, moderation levels, locale, and AFK timeout.",
      inputSchema: {
        guildId: snowflake,
        name: z.string().min(2).max(100).optional(),
        description: z.string().max(120).nullable().optional(),
        verificationLevel: enumInput.optional(),
        explicitContentFilter: enumInput.optional(),
        defaultMessageNotifications: enumInput.optional(),
        preferredLocale: z.string().min(2).max(32).optional(),
        afkTimeout: z.number().int().positive().optional(),
        confirm: z.boolean().optional(),
        reason: optionalReason,
      },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        const guild = await discord.getGuild(input.guildId);
        const updated = await guild.edit(guildEditOptions(input));
        return successResponse("Guild settings updated.", {
          guildId: updated.id,
          name: updated.name,
          description: updated.description,
          verificationLevel: updated.verificationLevel,
          explicitContentFilter: updated.explicitContentFilter,
          defaultMessageNotifications: updated.defaultMessageNotifications,
          preferredLocale: updated.preferredLocale,
          afkTimeout: updated.afkTimeout,
        });
      } catch (error) {
        return errorResponse("Failed to update guild settings.", { error: errorMessage(error) });
      }
    },
  );

  server.registerTool(
    "discord_create_invite",
    {
      title: "Create Discord invite",
      description: "Create an invite for a channel.",
      inputSchema: {
        channelId: snowflake,
        maxAge: z.number().int().min(0).max(604_800).optional(),
        maxUses: z.number().int().min(0).max(100).optional(),
        temporary: z.boolean().optional(),
        unique: z.boolean().optional(),
        confirm: z.boolean().optional(),
        reason: optionalReason,
      },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        const client = await discord.getClient();
        const channel = await client.channels.fetch(input.channelId);
        if (!channel || !("createInvite" in channel) || typeof channel.createInvite !== "function") {
          throw new Error(`Channel does not support invites: ${input.channelId}`);
        }

        const invite = await channel.createInvite({
          maxAge: input.maxAge,
          maxUses: input.maxUses,
          temporary: input.temporary,
          unique: input.unique,
          reason: input.reason,
        });

        return successResponse("Invite created.", {
          channelId: input.channelId,
          code: invite.code,
          url: invite.url,
          maxAge: invite.maxAge,
          maxUses: invite.maxUses,
          temporary: invite.temporary,
        });
      } catch (error) {
        return errorResponse("Failed to create invite.", { error: errorMessage(error) });
      }
    },
  );

  server.registerTool(
    "discord_create_webhook",
    {
      title: "Create Discord webhook",
      description: "Create a webhook in a text-capable guild channel.",
      inputSchema: {
        channelId: snowflake,
        name: z.string().min(1).max(80),
        avatar: z.string().optional(),
        confirm: z.boolean().optional(),
        reason: optionalReason,
      },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        const client = await discord.getClient();
        const channel = await client.channels.fetch(input.channelId);
        if (!channel || !("createWebhook" in channel) || typeof channel.createWebhook !== "function") {
          throw new Error(`Channel does not support webhooks: ${input.channelId}`);
        }

        const webhook = await channel.createWebhook({
          name: input.name,
          avatar: input.avatar,
          reason: input.reason,
        });

        return successResponse("Webhook created.", {
          channelId: input.channelId,
          webhookId: webhook.id,
          name: webhook.name,
          urlReturned: false,
          note: "Webhook URL is intentionally not returned because it contains a secret token.",
        });
      } catch (error) {
        return errorResponse("Failed to create webhook.", { error: errorMessage(error) });
      }
    },
  );

  server.registerTool(
    "discord_delete_webhook",
    {
      title: "Delete Discord webhook",
      description: "Delete a webhook by ID. Requires confirmation and either a backupId or allowWithoutBackup.",
      inputSchema: {
        webhookId: snowflake,
        confirm: z.boolean().optional(),
        reason: optionalReason,
        backupId: z.string().optional(),
        allowWithoutBackup: z.boolean().optional(),
      },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        const client = await discord.getClient();
        const webhook = await client.fetchWebhook(input.webhookId);
        const guildId = (webhook as { guildId?: string | null }).guildId;
        if (input.allowWithoutBackup !== true && !guildId) {
          throw new Error("Cannot verify webhook backup because Discord did not return a guildId.");
        }
        await requireDestructiveBackupForGuild(input, config.backupDir, guildId ?? "unknown");
        await webhook.delete(input.reason);
        return successResponse("Webhook deleted.", { webhookId: input.webhookId });
      } catch (error) {
        return errorResponse("Failed to delete webhook.", { error: errorMessage(error) });
      }
    },
  );
}
