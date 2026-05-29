import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ChannelType,
  PermissionFlagsBits,
  PermissionsBitField,
  type GuildChannelEditOptions,
} from "discord.js";
import { z } from "zod";
import type { ServerConfig } from "../config.js";
import type { DiscordClientManager } from "../discordClient.js";
import { errorResponse, successResponse } from "../responses.js";
import { requireConfirmation, requireDestructiveBackupForGuild } from "../safety.js";

const channelTypeByName = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  category: ChannelType.GuildCategory,
  forum: ChannelType.GuildForum,
  stage: ChannelType.GuildStageVoice,
} as const;

const confirmSchema = {
  confirm: z.boolean().optional(),
  reason: z.string().min(1).optional(),
};

const channelMutationResultSchema = {
  ok: z.boolean(),
  action: z.string(),
  channelId: z.string().optional(),
  guildId: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  targetId: z.string().optional(),
  targetType: z.string().optional(),
  updated: z.record(z.string(), z.unknown()).optional(),
  positions: z.array(z.object({ channelId: z.string(), position: z.number() })).optional(),
  error: z.string().optional(),
};

type EditableGuildChannel = {
  id: string;
  name: string;
  guildId: string;
  type: ChannelType;
  editable: boolean;
  edit(options: GuildChannelEditOptions): Promise<EditableGuildChannel>;
  delete(reason?: string): Promise<unknown>;
  permissionOverwrites: {
    edit(
      target: string,
      options: { allow: PermissionsBitField; deny: PermissionsBitField },
      reason?: string,
    ): Promise<unknown>;
  };
};

function parsePermissions(permissionNames: string[]): PermissionsBitField {
  return new PermissionsBitField(permissionNames.map((name) => PermissionFlagsBits[name as keyof typeof PermissionFlagsBits]));
}

function isPermissionName(name: string): name is keyof typeof PermissionFlagsBits {
  return Object.hasOwn(PermissionFlagsBits, name);
}

function validatePermissionNames(permissionNames: string[]): void {
  const invalid = permissionNames.filter((name) => !isPermissionName(name));
  if (invalid.length > 0) {
    throw new Error(`Invalid Discord permission name(s): ${invalid.join(", ")}`);
  }
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

async function getEditableChannel(
  discord: DiscordClientManager,
  channelId: string,
): Promise<EditableGuildChannel> {
  const client = await discord.getClient();
  const channel = await client.channels.fetch(channelId).catch(() => null);

  if (!channel || !("guildId" in channel) || !("editable" in channel) || !("edit" in channel)) {
    throw new Error(`Discord guild channel not found or unsupported: ${channelId}`);
  }

  const editableChannel = channel as unknown as EditableGuildChannel;
  if (!editableChannel.editable) {
    throw new Error(`Bot cannot edit channel due to missing permissions or hierarchy: ${channelId}`);
  }

  return editableChannel;
}

export function registerChannelTools(
  server: McpServer,
  discord: DiscordClientManager,
  config: ServerConfig,
): void {
  server.registerTool(
    "discord_create_channel",
    {
      title: "Create Discord channel",
      description: "Create a text, voice, category, forum, or stage channel.",
      inputSchema: {
        guildId: z.string(),
        name: z.string().min(1),
        type: z.enum(["text", "voice", "category", "forum", "stage"]),
        parentId: z.string().optional(),
        topic: z.string().optional(),
        nsfw: z.boolean().optional(),
        rateLimitPerUser: z.number().int().min(0).optional(),
        userLimit: z.number().int().min(0).optional(),
        bitrate: z.number().int().min(8000).optional(),
        ...confirmSchema,
      },
      outputSchema: channelMutationResultSchema,
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        const guild = await discord.getGuild(input.guildId);
        const channel = await guild.channels.create({
          name: input.name,
          type: channelTypeByName[input.type],
          parent: input.parentId,
          topic: input.topic,
          nsfw: input.nsfw,
          rateLimitPerUser: input.rateLimitPerUser,
          userLimit: input.userLimit,
          bitrate: input.bitrate,
          reason: input.reason,
        });

        return successResponse("Channel created.", {
          ok: true,
          action: "discord_create_channel",
          channelId: channel.id,
          guildId: guild.id,
          name: channel.name,
          type: input.type,
        });
      } catch (error) {
        return errorResponse("Failed to create channel.", {
          ok: false,
          action: "discord_create_channel",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_update_channel",
    {
      title: "Update Discord channel",
      description: "Update editable properties on a Discord guild channel.",
      inputSchema: {
        channelId: z.string(),
        name: z.string().min(1).optional(),
        topic: z.string().nullable().optional(),
        nsfw: z.boolean().optional(),
        rateLimitPerUser: z.number().int().min(0).optional(),
        parentId: z.string().nullable().optional(),
        ...confirmSchema,
      },
      outputSchema: channelMutationResultSchema,
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        const channel = await getEditableChannel(discord, input.channelId);
        const updates = compactObject({
          name: input.name,
          topic: input.topic,
          nsfw: input.nsfw,
          rateLimitPerUser: input.rateLimitPerUser,
          parent: input.parentId,
          reason: input.reason,
        });

        const updated = await channel.edit(updates);
        return successResponse("Channel updated.", {
          ok: true,
          action: "discord_update_channel",
          channelId: updated.id,
          guildId: updated.guildId,
          name: updated.name,
          updated: updates,
        });
      } catch (error) {
        return errorResponse("Failed to update channel.", {
          ok: false,
          action: "discord_update_channel",
          channelId: input.channelId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_delete_channel",
    {
      title: "Delete Discord channel",
      description: "Delete a Discord guild channel after confirmation and backup acknowledgement.",
      inputSchema: {
        channelId: z.string(),
        backupId: z.string().nullable().optional(),
        allowWithoutBackup: z.boolean().optional(),
        ...confirmSchema,
      },
      outputSchema: channelMutationResultSchema,
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        const channel = await getEditableChannel(discord, input.channelId);
        await requireDestructiveBackupForGuild(input, config.backupDir, channel.guildId);
        await channel.delete(input.reason);

        return successResponse("Channel deleted.", {
          ok: true,
          action: "discord_delete_channel",
          channelId: input.channelId,
          guildId: channel.guildId,
          name: channel.name,
        });
      } catch (error) {
        return errorResponse("Failed to delete channel.", {
          ok: false,
          action: "discord_delete_channel",
          channelId: input.channelId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_set_channel_permissions",
    {
      title: "Set Discord channel permissions",
      description: "Set explicit channel permission overwrites for a role or member.",
      inputSchema: {
        channelId: z.string(),
        targetId: z.string(),
        targetType: z.enum(["role", "member"]),
        allow: z.array(z.string()),
        deny: z.array(z.string()),
        ...confirmSchema,
      },
      outputSchema: channelMutationResultSchema,
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        validatePermissionNames([...input.allow, ...input.deny]);
        const channel = await getEditableChannel(discord, input.channelId);
        const guild = await discord.getGuild(channel.guildId);
        if (input.targetType === "role") {
          const role = await guild.roles.fetch(input.targetId).catch(() => null);
          if (!role) {
            throw new Error(`Discord role permission target not found: ${input.targetId}`);
          }
        } else {
          await guild.members.fetch(input.targetId).catch(() => {
            throw new Error(`Discord member permission target not found: ${input.targetId}`);
          });
        }

        await channel.permissionOverwrites.edit(
          input.targetId,
          {
            allow: parsePermissions(input.allow),
            deny: parsePermissions(input.deny),
          },
          input.reason,
        );

        return successResponse("Channel permissions updated.", {
          ok: true,
          action: "discord_set_channel_permissions",
          channelId: channel.id,
          guildId: channel.guildId,
          targetId: input.targetId,
          targetType: input.targetType,
          updated: { allow: input.allow, deny: input.deny },
        });
      } catch (error) {
        return errorResponse("Failed to update channel permissions.", {
          ok: false,
          action: "discord_set_channel_permissions",
          channelId: input.channelId,
          targetId: input.targetId,
          targetType: input.targetType,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_reorder_channels",
    {
      title: "Reorder Discord channels",
      description: "Set channel positions within a guild.",
      inputSchema: {
        guildId: z.string(),
        positions: z.array(z.object({ channelId: z.string(), position: z.number().int().min(0) })).min(1),
        ...confirmSchema,
      },
      outputSchema: channelMutationResultSchema,
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        const guild = await discord.getGuild(input.guildId);
        const me = await guild.members.fetchMe();
        if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
          throw new Error("Bot requires ManageChannels to reorder channels.");
        }

        await guild.channels.setPositions(
          input.positions.map((position) => ({
            channel: position.channelId,
            position: position.position,
          })),
        );

        return successResponse("Channels reordered.", {
          ok: true,
          action: "discord_reorder_channels",
          guildId: guild.id,
          positions: input.positions,
        });
      } catch (error) {
        return errorResponse("Failed to reorder channels.", {
          ok: false,
          action: "discord_reorder_channels",
          guildId: input.guildId,
          positions: input.positions,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );
}
