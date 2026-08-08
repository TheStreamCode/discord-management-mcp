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
import { safeErrorMessage } from "../errors.js";
import { errorResponse, successResponse } from "../responses.js";
import { requireConfirmation, requireDestructiveBackupForGuild } from "../safety.js";
import {
  additiveDiscordAnnotations,
  destructiveDiscordAnnotations,
  idempotentDiscordMutationAnnotations,
} from "../toolAnnotations.js";
import { defaultOutputToolRegistrar } from "../toolRegistration.js";
import {
  auditReasonSchema,
  backupIdInputSchema,
  discordSnowflakeSchema,
  enumMember,
  requireAtLeastOneInputField,
} from "../toolSchemas.js";

const enumInput = z.union([z.string(), z.number()]);

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
      : enumMember<GuildVerificationLevel>(input.verificationLevel, GuildVerificationLevel, "verificationLevel"),
    explicitContentFilter: input.explicitContentFilter === undefined
      ? undefined
      : enumMember<GuildExplicitContentFilter>(
        input.explicitContentFilter,
        GuildExplicitContentFilter,
        "explicitContentFilter",
      ),
    defaultMessageNotifications: input.defaultMessageNotifications === undefined
      ? undefined
      : enumMember<GuildDefaultMessageNotifications>(
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
  const registerTool = defaultOutputToolRegistrar(server);

  registerTool(
    "discord_update_guild_settings",
    {
      title: "Update Discord guild settings",
      description: "Update basic guild settings such as name, description, moderation levels, locale, and AFK timeout.",
      annotations: idempotentDiscordMutationAnnotations,
      inputSchema: {
        guildId: discordSnowflakeSchema,
        name: z.string().min(2).max(100).optional(),
        description: z.string().max(120).nullable().optional(),
        verificationLevel: enumInput.optional(),
        explicitContentFilter: enumInput.optional(),
        defaultMessageNotifications: enumInput.optional(),
        preferredLocale: z.string().min(2).max(32).optional(),
        afkTimeout: z.number().int().positive().optional(),
        confirm: z.boolean().optional(),
        reason: auditReasonSchema,
      },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        requireAtLeastOneInputField(input, [
          "name",
          "description",
          "verificationLevel",
          "explicitContentFilter",
          "defaultMessageNotifications",
          "preferredLocale",
          "afkTimeout",
        ]);
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
        return errorResponse("Failed to update guild settings.", { error: safeErrorMessage(error) });
      }
    },
  );

  registerTool(
    "discord_create_invite",
    {
      title: "Create Discord invite",
      description: "Create an invite for a channel without returning its secret code or URL.",
      annotations: additiveDiscordAnnotations,
      inputSchema: {
        channelId: discordSnowflakeSchema,
        maxAge: z.number().int().min(0).max(604_800).optional(),
        maxUses: z.number().int().min(0).max(100).optional(),
        temporary: z.boolean().optional(),
        unique: z.boolean().optional(),
        confirm: z.boolean().optional(),
        reason: auditReasonSchema,
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
          maxAge: invite.maxAge,
          maxUses: invite.maxUses,
          temporary: invite.temporary,
          secretReturned: false,
          note: "Invite code and URL are intentionally omitted because they grant access to the guild.",
        });
      } catch (error) {
        return errorResponse("Failed to create invite.", { error: safeErrorMessage(error) });
      }
    },
  );

  registerTool(
    "discord_create_webhook",
    {
      title: "Create Discord webhook",
      description: "Create a webhook in a text-capable guild channel.",
      annotations: additiveDiscordAnnotations,
      inputSchema: {
        channelId: discordSnowflakeSchema,
        name: z.string().min(1).max(80),
        avatar: z.string().max(10_000_000).optional(),
        confirm: z.boolean().optional(),
        reason: auditReasonSchema,
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
        return errorResponse("Failed to create webhook.", { error: safeErrorMessage(error) });
      }
    },
  );

  registerTool(
    "discord_delete_webhook",
    {
      title: "Delete Discord webhook",
      description: "Delete a webhook by ID. Requires confirmation and either a backupId or allowWithoutBackup.",
      annotations: destructiveDiscordAnnotations,
      inputSchema: {
        webhookId: discordSnowflakeSchema,
        confirm: z.boolean().optional(),
        reason: auditReasonSchema,
        backupId: backupIdInputSchema.optional(),
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
        return errorResponse("Failed to delete webhook.", { error: safeErrorMessage(error) });
      }
    },
  );
}
