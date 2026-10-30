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
import { safeErrorMessage } from "../errors.js";
import { withMutationQueue } from "../mutationQueue.js";
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
  requireAtLeastOneInputField,
  requireUniqueValues,
} from "../toolSchemas.js";

const channelTypeByName = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  category: ChannelType.GuildCategory,
  forum: ChannelType.GuildForum,
  stage: ChannelType.GuildStageVoice,
} as const;

const voiceChannelTypes = new Set<number>([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);
const rtcRegionSchema = z.string().trim().min(1).max(64);

const confirmSchema = {
  confirm: z.boolean().optional(),
  reason: auditReasonSchema,
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
  status: z.string().nullable().optional(),
  cleared: z.boolean().optional(),
  note: z.string().optional(),
  error: z.string().optional(),
};

type EditableGuildChannel = {
  id: string;
  name: string;
  guildId: string;
  type: ChannelType;
  manageable: boolean;
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

function validateVoiceFields(
  values: { bitrate?: number; userLimit?: number; rtcRegion?: string | null },
  channelType: number,
  channelLabel: string,
): void {
  const hasVoiceField =
    values.bitrate !== undefined || values.userLimit !== undefined || values.rtcRegion !== undefined;

  if (hasVoiceField && !voiceChannelTypes.has(channelType)) {
    throw new Error(
      `bitrate, userLimit, and rtcRegion are only supported on voice and stage channels (${channelLabel}).`,
    );
  }
}

async function getEditableChannel(
  discord: DiscordClientManager,
  channelId: string,
): Promise<EditableGuildChannel> {
  const client = await discord.getClient();
  const channel = await client.channels.fetch(channelId).catch(() => null);

  if (
    !channel ||
    !("guildId" in channel) ||
    typeof (channel as { edit?: unknown }).edit !== "function"
  ) {
    throw new Error(`Discord guild channel not found or unsupported: ${channelId}`);
  }

  const editableChannel = channel as unknown as EditableGuildChannel;
  // `editable` only exists on messages, roles, and threads in discord.js 14;
  // guild channels expose `manageable` instead. Checking the wrong getter made
  // every channel update, delete, and overwrite fail against real Discord.
  if (editableChannel.manageable === false) {
    throw new Error(`Bot cannot edit channel due to missing permissions or hierarchy: ${channelId}`);
  }

  return editableChannel;
}

export function registerChannelTools(
  server: McpServer,
  discord: DiscordClientManager,
  config: ServerConfig,
): void {
  const registerTool = withMutationQueue(defaultOutputToolRegistrar(server));

  registerTool(
    "discord_create_channel",
    {
      title: "Create Discord channel",
      description: "Create a text, voice, category, forum, or stage channel.",
      inputSchema: {
        guildId: discordSnowflakeSchema,
        name: z.string().trim().min(1).max(100),
        type: z.enum(["text", "voice", "category", "forum", "stage"]),
        parentId: discordSnowflakeSchema.optional(),
        topic: z.string().max(4_096).optional(),
        nsfw: z.boolean().optional(),
        rateLimitPerUser: z.number().int().min(0).max(21_600).optional(),
        userLimit: z.number().int().min(0).max(99).optional(),
        bitrate: z.number().int().min(8_000).max(384_000).optional(),
        rtcRegion: rtcRegionSchema.nullable().optional(),
        ...confirmSchema,
      },
      outputSchema: channelMutationResultSchema,
      annotations: additiveDiscordAnnotations,
    },
    async (input) => {
      try {
        requireConfirmation(input);
        validateVoiceFields(input, channelTypeByName[input.type], input.type);
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
          rtcRegion: input.rtcRegion ?? undefined,
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
          error: safeErrorMessage(error),
        });
      }
    },
  );

  registerTool(
    "discord_update_channel",
    {
      title: "Update Discord channel",
      description: "Update editable properties on a Discord guild channel, including voice bitrate, user limit, and RTC region.",
      inputSchema: {
        channelId: discordSnowflakeSchema,
        name: z.string().trim().min(1).max(100).optional(),
        topic: z.string().max(4_096).nullable().optional(),
        nsfw: z.boolean().optional(),
        rateLimitPerUser: z.number().int().min(0).max(21_600).optional(),
        parentId: discordSnowflakeSchema.nullable().optional(),
        userLimit: z.number().int().min(0).max(99).optional(),
        bitrate: z.number().int().min(8_000).max(384_000).optional(),
        rtcRegion: rtcRegionSchema.nullable().optional(),
        ...confirmSchema,
      },
      outputSchema: channelMutationResultSchema,
      annotations: idempotentDiscordMutationAnnotations,
    },
    async (input) => {
      try {
        requireConfirmation(input);
        requireAtLeastOneInputField(input, [
          "name",
          "topic",
          "nsfw",
          "rateLimitPerUser",
          "parentId",
          "userLimit",
          "bitrate",
          "rtcRegion",
        ]);
        const channel = await getEditableChannel(discord, input.channelId);
        validateVoiceFields(input, channel.type, `channel ${input.channelId}`);
        const updates = compactObject({
          name: input.name,
          topic: input.topic,
          nsfw: input.nsfw,
          rateLimitPerUser: input.rateLimitPerUser,
          parent: input.parentId,
          userLimit: input.userLimit,
          bitrate: input.bitrate,
          rtcRegion: input.rtcRegion,
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
          error: safeErrorMessage(error),
        });
      }
    },
  );

  registerTool(
    "discord_delete_channel",
    {
      title: "Delete Discord channel",
      description: "Delete a Discord guild channel after confirmation and backup acknowledgement.",
      inputSchema: {
        channelId: discordSnowflakeSchema,
        backupId: backupIdInputSchema.nullable().optional(),
        allowWithoutBackup: z.boolean().optional(),
        ...confirmSchema,
      },
      outputSchema: channelMutationResultSchema,
      annotations: destructiveDiscordAnnotations,
    },
    async (input) => {
      try {
        requireConfirmation(input);
        const channel = await getEditableChannel(discord, input.channelId);
        await requireDestructiveBackupForGuild(input, config.backupDir, channel.guildId, config.projectRoot);
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
          error: safeErrorMessage(error),
        });
      }
    },
  );

  registerTool(
    "discord_set_channel_permissions",
    {
      title: "Set Discord channel permissions",
      description: "Set explicit channel permission overwrites for a role or member.",
      inputSchema: {
        channelId: discordSnowflakeSchema,
        targetId: discordSnowflakeSchema,
        targetType: z.enum(["role", "member"]),
        allow: z.array(z.string().min(1).max(100)).max(100),
        deny: z.array(z.string().min(1).max(100)).max(100),
        backupId: backupIdInputSchema.nullable().optional(),
        allowWithoutBackup: z.boolean().optional(),
        ...confirmSchema,
      },
      outputSchema: channelMutationResultSchema,
      annotations: idempotentDiscordMutationAnnotations,
    },
    async (input) => {
      try {
        requireConfirmation(input);
        validatePermissionNames([...input.allow, ...input.deny]);
        const channel = await getEditableChannel(discord, input.channelId);
        await requireDestructiveBackupForGuild(input, config.backupDir, channel.guildId, config.projectRoot);
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
          error: safeErrorMessage(error),
        });
      }
    },
  );

  registerTool(
    "discord_reorder_channels",
    {
      title: "Reorder Discord channels",
      description: "Set channel positions within a guild.",
      inputSchema: {
        guildId: discordSnowflakeSchema,
        positions: z.array(z.object({ channelId: discordSnowflakeSchema, position: z.number().int().min(0).max(499) })).min(1).max(500),
        ...confirmSchema,
      },
      outputSchema: channelMutationResultSchema,
      annotations: idempotentDiscordMutationAnnotations,
    },
    async (input) => {
      try {
        requireConfirmation(input);
        requireUniqueValues(input.positions.map(({ channelId }) => channelId), "positions.channelId");
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
          error: safeErrorMessage(error),
        });
      }
    },
  );

  registerTool(
    "discord_set_voice_channel_status",
    {
      title: "Set Discord voice channel status",
      description:
        "Set or clear the status text shown on a voice channel. Uses the Discord REST voice-status endpoint and requires the bot to be allowed to manage the channel.",
      inputSchema: {
        channelId: discordSnowflakeSchema,
        status: z.string().trim().min(1).max(500).nullable(),
        ...confirmSchema,
      },
      outputSchema: channelMutationResultSchema,
      annotations: additiveDiscordAnnotations,
    },
    async (input) => {
      try {
        requireConfirmation(input);
        const channel = await getEditableChannel(discord, input.channelId);
        if (!voiceChannelTypes.has(channel.type)) {
          throw new Error(
            `Voice channel status is only supported on voice and stage channels: ${input.channelId}`,
          );
        }

        const client = await discord.getClient();
        await client.rest.put(`/channels/${input.channelId}/voice-status`, {
          body: { status: input.status },
          reason: input.reason,
        });

        const cleared = input.status === null;
        return successResponse(cleared ? "Voice channel status cleared." : "Voice channel status updated.", {
          ok: true,
          action: "discord_set_voice_channel_status",
          channelId: input.channelId,
          guildId: channel.guildId,
          status: input.status,
          cleared,
        });
      } catch (error) {
        return errorResponse("Failed to set voice channel status.", {
          ok: false,
          action: "discord_set_voice_channel_status",
          channelId: input.channelId,
          error: safeErrorMessage(error),
        });
      }
    },
  );
}
