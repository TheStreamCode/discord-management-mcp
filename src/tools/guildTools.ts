import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ApplicationCommand,
  AutoModerationRule,
  Guild,
  GuildBasedChannel,
  GuildEmoji,
  GuildMember,
  GuildScheduledEvent,
  Invite,
  Message,
  NonThreadGuildBasedChannel,
  Role,
  Sticker,
  Webhook,
} from "discord.js";
import { z } from "zod";
import type { ServerConfig } from "../config.js";
import type { DiscordClientManager } from "../discordClient.js";
import { errorResponse, successResponse } from "../responses.js";

type JsonObject = Record<string, unknown>;

const emptySchema = z.object({});
const guildIdSchema = {
  guildId: z.string().min(1, "guildId is required"),
};
const channelIdSchema = {
  ...guildIdSchema,
  channelId: z.string().min(1, "channelId is required"),
};
const roleIdSchema = {
  ...guildIdSchema,
  roleId: z.string().min(1, "roleId is required"),
};
const listMembersSchema = {
  ...guildIdSchema,
  limit: z.number().int().min(1).max(1000).default(100),
  after: z.string().min(1).optional(),
};
const listMessagesSchema = {
  ...channelIdSchema,
  limit: z.number().int().min(1).max(100).default(25),
  before: z.string().min(1).optional(),
  after: z.string().min(1).optional(),
  around: z.string().min(1).optional(),
};
const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Discord API error.";
}

function toIsoDate(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "number") {
    return new Date(value).toISOString();
  }
  return null;
}

function cacheIds(value: unknown): string[] {
  const cache = value as { cache?: Map<string, unknown> } | undefined;
  return cache?.cache instanceof Map ? [...cache.cache.keys()] : [];
}

function bitfieldToString(value: unknown): string | null {
  if (
    value &&
    typeof value === "object" &&
    "bitfield" in value &&
    typeof value.bitfield === "bigint"
  ) {
    return value.bitfield.toString();
  }
  return null;
}

function mapGuild(guild: Guild): JsonObject {
  return {
    id: guild.id,
    name: guild.name,
    ownerId: guild.ownerId,
    description: guild.description,
    preferredLocale: guild.preferredLocale,
    memberCount: guild.memberCount,
    approximateMemberCount: guild.approximateMemberCount,
    approximatePresenceCount: guild.approximatePresenceCount,
    available: guild.available,
    large: guild.large,
    premiumTier: guild.premiumTier,
    mfaLevel: guild.mfaLevel,
    verificationLevel: guild.verificationLevel,
    explicitContentFilter: guild.explicitContentFilter,
    defaultMessageNotifications: guild.defaultMessageNotifications,
    systemChannelId: guild.systemChannelId,
    rulesChannelId: guild.rulesChannelId,
    publicUpdatesChannelId: guild.publicUpdatesChannelId,
    safetyAlertsChannelId: guild.safetyAlertsChannelId,
    afkChannelId: guild.afkChannelId,
    afkTimeout: guild.afkTimeout,
    widgetEnabled: guild.widgetEnabled,
    widgetChannelId: guild.widgetChannelId,
    joinedAt: toIsoDate(guild.joinedAt),
    createdAt: toIsoDate(guild.createdAt),
  };
}

function mapPartialGuild(guild: {
  id: string;
  name: string;
  icon?: string | null;
  owner?: boolean;
  permissions?: unknown;
  features?: readonly string[];
}): JsonObject {
  return {
    id: guild.id,
    name: guild.name,
    icon: guild.icon ?? null,
    owner: guild.owner ?? null,
    permissions: bitfieldToString(guild.permissions),
    features: guild.features ?? [],
  };
}

function mapChannel(channel: GuildBasedChannel): JsonObject {
  const raw = channel as GuildBasedChannel & {
    bitrate?: number;
    defaultAutoArchiveDuration?: number;
    nsfw?: boolean;
    parentId?: string | null;
    permissionOverwrites?: { cache?: Map<string, unknown> };
    position?: number;
    rateLimitPerUser?: number;
    rtcRegion?: string | null;
    topic?: string | null;
    userLimit?: number;
  };

  return {
    id: channel.id,
    guildId: channel.guildId,
    name: channel.name,
    type: channel.type,
    parentId: raw.parentId ?? null,
    position: raw.position ?? null,
    topic: raw.topic ?? null,
    nsfw: raw.nsfw ?? null,
    rateLimitPerUser: raw.rateLimitPerUser ?? null,
    bitrate: raw.bitrate ?? null,
    userLimit: raw.userLimit ?? null,
    rtcRegion: raw.rtcRegion ?? null,
    defaultAutoArchiveDuration: raw.defaultAutoArchiveDuration ?? null,
    permissionOverwriteIds: cacheIds(raw.permissionOverwrites),
    createdAt: toIsoDate(channel.createdAt),
  };
}

function mapRole(role: Role): JsonObject {
  return {
    id: role.id,
    guildId: role.guild.id,
    name: role.name,
    color: role.color,
    hexColor: role.hexColor,
    hoist: role.hoist,
    managed: role.managed,
    mentionable: role.mentionable,
    position: role.position,
    permissions: role.permissions.bitfield.toString(),
    tags: role.tags
      ? {
          botId: role.tags.botId,
          integrationId: role.tags.integrationId,
          premiumSubscriberRole: role.tags.premiumSubscriberRole ?? false,
          subscriptionListingId: role.tags.subscriptionListingId,
          availableForPurchase: role.tags.availableForPurchase ?? false,
          guildConnections: role.tags.guildConnections ?? false,
        }
      : null,
    createdAt: toIsoDate(role.createdAt),
  };
}

function mapMember(member: GuildMember): JsonObject {
  return {
    id: member.id,
    guildId: member.guild.id,
    user: {
      id: member.user.id,
      username: member.user.username,
      discriminator: member.user.discriminator,
      globalName: member.user.globalName,
      bot: member.user.bot,
      system: member.user.system,
    },
    nickname: member.nickname,
    roleIds: [...member.roles.cache.keys()],
    joinedAt: toIsoDate(member.joinedAt),
    premiumSince: toIsoDate(member.premiumSince),
    pending: member.pending,
    communicationDisabledUntil: toIsoDate(member.communicationDisabledUntil),
  };
}

function mapAutoModerationRule(rule: AutoModerationRule): JsonObject {
  return {
    id: rule.id,
    guildId: rule.guild.id,
    name: rule.name,
    creatorId: rule.creatorId,
    enabled: rule.enabled,
    eventType: rule.eventType,
    triggerType: rule.triggerType,
    triggerMetadata: rule.triggerMetadata,
    actions: rule.actions,
    exemptRoleIds: [...rule.exemptRoles.keys()],
    exemptChannelIds: [...rule.exemptChannels.keys()],
  };
}

function mapScheduledEvent(event: GuildScheduledEvent): JsonObject {
  return {
    id: event.id,
    guildId: event.guildId,
    channelId: event.channelId,
    creatorId: event.creatorId,
    name: event.name,
    description: event.description,
    scheduledStartAt: toIsoDate(event.scheduledStartAt),
    scheduledEndAt: toIsoDate(event.scheduledEndAt),
    privacyLevel: event.privacyLevel,
    status: event.status,
    entityType: event.entityType,
    entityId: event.entityId,
    entityMetadata: event.entityMetadata,
    userCount: event.userCount,
    createdAt: toIsoDate(event.createdAt),
  };
}

function mapWebhook(webhook: Webhook): JsonObject {
  return {
    id: webhook.id,
    guildId: webhook.guildId,
    channelId: webhook.channelId,
    name: webhook.name,
    type: webhook.type,
    ownerId: webhook.owner?.id ?? null,
    applicationId: webhook.applicationId,
    sourceGuildId: webhook.sourceGuild?.id ?? null,
    sourceChannelId: webhook.sourceChannel?.id ?? null,
    createdAt: toIsoDate(webhook.createdAt),
  };
}

function mapInvite(invite: Invite): JsonObject {
  return {
    code: invite.code,
    guildId: invite.guild?.id ?? null,
    channelId: invite.channel?.id ?? null,
    inviterId: invite.inviter?.id ?? null,
    targetType: invite.targetType,
    targetUserId: invite.targetUser?.id ?? null,
    targetApplicationId: invite.targetApplication?.id ?? null,
    uses: invite.uses,
    maxUses: invite.maxUses,
    maxAge: invite.maxAge,
    temporary: invite.temporary,
    createdAt: toIsoDate(invite.createdAt),
    expiresAt: toIsoDate(invite.expiresAt),
  };
}

function mapEmoji(emoji: GuildEmoji): JsonObject {
  return {
    id: emoji.id,
    guildId: emoji.guild.id,
    name: emoji.name,
    animated: emoji.animated,
    available: emoji.available,
    managed: emoji.managed,
    requiresColons: emoji.requiresColons,
    roleIds: [...emoji.roles.cache.keys()],
    authorId: emoji.author?.id ?? null,
    createdAt: toIsoDate(emoji.createdAt),
  };
}

function mapSticker(sticker: Sticker): JsonObject {
  return {
    id: sticker.id,
    guildId: sticker.guildId,
    name: sticker.name,
    description: sticker.description,
    type: sticker.type,
    format: sticker.format,
    tags: sticker.tags,
    available: sticker.available,
    userId: sticker.user?.id ?? null,
    createdAt: toIsoDate(sticker.createdAt),
  };
}

function mapApplicationCommand(command: ApplicationCommand): JsonObject {
  return {
    id: command.id,
    applicationId: command.applicationId,
    guildId: command.guildId,
    name: command.name,
    nameLocalizations: command.nameLocalizations,
    description: command.description,
    descriptionLocalizations: command.descriptionLocalizations,
    type: command.type,
    options: command.options,
    defaultMemberPermissions:
      command.defaultMemberPermissions?.bitfield.toString() ?? null,
    dmPermission: command.dmPermission,
    nsfw: command.nsfw,
    version: command.version,
    createdAt: toIsoDate(command.createdAt),
  };
}

function mapMessage(message: Message): JsonObject {
  return {
    id: message.id,
    channelId: message.channelId,
    guildId: message.guildId,
    author: message.author
      ? {
          id: message.author.id,
          username: message.author.username,
          globalName: message.author.globalName,
          bot: message.author.bot,
          system: message.author.system,
        }
      : null,
    content: message.content,
    cleanContent: message.cleanContent,
    createdAt: toIsoDate(message.createdAt),
    editedAt: toIsoDate(message.editedAt),
    pinned: message.pinned,
    tts: message.tts,
    type: message.type,
    system: message.system,
    reference: message.reference
      ? {
          messageId: message.reference.messageId,
          channelId: message.reference.channelId,
          guildId: message.reference.guildId,
        }
      : null,
    embeds: message.embeds.map((embed) => ({
      title: embed.title,
      description: embed.description,
      url: embed.url,
      timestamp: embed.timestamp,
      color: embed.color,
      fields: embed.fields.map((field) => ({
        name: field.name,
        value: field.value,
        inline: field.inline ?? false,
      })),
      footer: embed.footer ? { text: embed.footer.text } : null,
      author: embed.author ? { name: embed.author.name, url: embed.author.url } : null,
    })),
    attachments: [...message.attachments.values()].map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      contentType: attachment.contentType,
      size: attachment.size,
      url: attachment.url,
      width: attachment.width,
      height: attachment.height,
    })),
    mentionIds: {
      users: [...message.mentions.users.keys()],
      roles: [...message.mentions.roles.keys()],
      channels: [...message.mentions.channels.keys()],
    },
  };
}

export function registerGuildTools(
  server: McpServer,
  discord: DiscordClientManager,
  config: ServerConfig,
): void {
  server.registerTool(
    "discord_list_guilds",
    {
      description: "List Discord guilds visible to the configured bot.",
      inputSchema: emptySchema,
      annotations: readOnlyAnnotations,
    },
    async () => {
      try {
        const client = await discord.getClient();
        const guilds = [...(await client.guilds.fetch()).values()].map(mapPartialGuild);
        return successResponse(`Found ${guilds.length} guild(s).`, {
          count: guilds.length,
          guilds,
        });
      } catch (error) {
        return errorResponse("Failed to list Discord guilds.", {
          error: errorText(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_get_guild",
    {
      description: "Get Discord guild metadata.",
      inputSchema: guildIdSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ guildId }) => {
      try {
        const guild = await discord.getGuild(guildId);
        return successResponse(`Guild ${guild.name} (${guild.id}).`, {
          guild: mapGuild(guild),
        });
      } catch (error) {
        return errorResponse("Failed to get Discord guild.", {
          guildId,
          error: errorText(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_list_channels",
    {
      description: "List channels in a Discord guild.",
      inputSchema: guildIdSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ guildId }) => {
      try {
        const guild = await discord.getGuild(guildId);
        const channels = [...(await guild.channels.fetch()).values()]
          .filter((channel): channel is NonThreadGuildBasedChannel => channel !== null)
          .map(mapChannel);
        return successResponse(`Found ${channels.length} channel(s).`, {
          guildId,
          count: channels.length,
          channels,
        });
      } catch (error) {
        return errorResponse("Failed to list Discord channels.", {
          guildId,
          error: errorText(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_get_channel",
    {
      description: "Get Discord channel metadata.",
      inputSchema: channelIdSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ guildId, channelId }) => {
      try {
        const guild = await discord.getGuild(guildId);
        const channel = await guild.channels.fetch(channelId);
        if (!channel) {
          throw new Error(`Discord channel not found or inaccessible: ${channelId}`);
        }
        return successResponse(`Channel ${channel.name} (${channel.id}).`, {
          guildId,
          channel: mapChannel(channel),
        });
      } catch (error) {
        return errorResponse("Failed to get Discord channel.", {
          guildId,
          channelId,
          error: errorText(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_list_channel_messages",
    {
      description:
        "List recent messages from a text-based channel. Requires ENABLE_MESSAGE_CONTENT=true and the Discord Message Content privileged intent.",
      inputSchema: listMessagesSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ guildId, channelId, limit, before, after, around }) => {
      if (!config.enableMessageContent) {
        return errorResponse("Message content reading is disabled.", {
          guildId,
          channelId,
          messageContentEnabled: false,
          nextStep:
            "Set ENABLE_MESSAGE_CONTENT=true and enable Message Content Intent in Discord Developer Portal > Bot > Privileged Gateway Intents.",
        });
      }

      try {
        const guild = await discord.getGuild(guildId);
        const channel = await guild.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) {
          throw new Error(`Discord text channel not found or inaccessible: ${channelId}`);
        }

        const messages = [
          ...(await channel.messages.fetch({
            limit,
            before,
            after,
            around,
            cache: false,
          })).values(),
        ].map(mapMessage);

        const possiblyMissingContent = messages.every(
          (message) =>
            message.content === "" &&
            Array.isArray(message.embeds) &&
            message.embeds.length === 0 &&
            Array.isArray(message.attachments) &&
            message.attachments.length === 0,
        );

        return successResponse(`Found ${messages.length} message(s).`, {
          guildId,
          channelId,
          count: messages.length,
          limit,
          before: before ?? null,
          after: after ?? null,
          around: around ?? null,
          messageContentEnabled: true,
          possiblyMissingContent,
          warning: possiblyMissingContent
            ? "Discord returned empty content/embed/attachment fields. Confirm the Developer Portal Message Content Intent is enabled for this bot."
            : null,
          messages,
        });
      } catch (error) {
        return errorResponse("Failed to list Discord channel messages.", {
          guildId,
          channelId,
          limit,
          before: before ?? null,
          after: after ?? null,
          around: around ?? null,
          error: errorText(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_list_roles",
    {
      description: "List roles in a Discord guild.",
      inputSchema: guildIdSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ guildId }) => {
      try {
        const guild = await discord.getGuild(guildId);
        const roles = [...(await guild.roles.fetch()).values()].map(mapRole);
        return successResponse(`Found ${roles.length} role(s).`, {
          guildId,
          count: roles.length,
          roles,
        });
      } catch (error) {
        return errorResponse("Failed to list Discord roles.", {
          guildId,
          error: errorText(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_get_role",
    {
      description: "Get Discord role metadata.",
      inputSchema: roleIdSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ guildId, roleId }) => {
      try {
        const guild = await discord.getGuild(guildId);
        const role = await guild.roles.fetch(roleId);
        if (!role) {
          throw new Error(`Discord role not found or inaccessible: ${roleId}`);
        }
        return successResponse(`Role ${role.name} (${role.id}).`, {
          guildId,
          role: mapRole(role),
        });
      } catch (error) {
        return errorResponse("Failed to get Discord role.", {
          guildId,
          roleId,
          error: errorText(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_list_members",
    {
      description: "List guild members, capped at 1000.",
      inputSchema: listMembersSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ guildId, limit, after }) => {
      try {
        const guild = await discord.getGuild(guildId);
        const members = [
          ...(await guild.members.list({ limit, after, cache: false })).values(),
        ].map(mapMember);
        return successResponse(`Found ${members.length} member(s).`, {
          guildId,
          count: members.length,
          limit,
          after: after ?? null,
          members,
        });
      } catch (error) {
        return errorResponse("Failed to list Discord members.", {
          guildId,
          limit,
          after: after ?? null,
          error: errorText(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_list_automod_rules",
    {
      description: "List AutoMod rules in a Discord guild.",
      inputSchema: guildIdSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ guildId }) => {
      try {
        const guild = await discord.getGuild(guildId);
        const rules = [...(await guild.autoModerationRules.fetch()).values()].map(
          mapAutoModerationRule,
        );
        return successResponse(`Found ${rules.length} AutoMod rule(s).`, {
          guildId,
          count: rules.length,
          rules,
        });
      } catch (error) {
        return errorResponse("Failed to list Discord AutoMod rules.", {
          guildId,
          error: errorText(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_list_scheduled_events",
    {
      description: "List scheduled events in a Discord guild.",
      inputSchema: guildIdSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ guildId }) => {
      try {
        const guild = await discord.getGuild(guildId);
        const events = [...(await guild.scheduledEvents.fetch()).values()].map(
          mapScheduledEvent,
        );
        return successResponse(`Found ${events.length} scheduled event(s).`, {
          guildId,
          count: events.length,
          events,
        });
      } catch (error) {
        return errorResponse("Failed to list Discord scheduled events.", {
          guildId,
          error: errorText(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_list_webhooks",
    {
      description: "List webhooks in a Discord guild without exposing tokens.",
      inputSchema: guildIdSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ guildId }) => {
      try {
        const guild = await discord.getGuild(guildId);
        const webhooks = [...(await guild.fetchWebhooks()).values()].map(mapWebhook);
        return successResponse(`Found ${webhooks.length} webhook(s).`, {
          guildId,
          count: webhooks.length,
          webhooks,
        });
      } catch (error) {
        return errorResponse("Failed to list Discord webhooks.", {
          guildId,
          error: errorText(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_list_invites",
    {
      description: "List invites in a Discord guild.",
      inputSchema: guildIdSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ guildId }) => {
      try {
        const guild = await discord.getGuild(guildId);
        const invites = [...(await guild.invites.fetch()).values()].map(mapInvite);
        return successResponse(`Found ${invites.length} invite(s).`, {
          guildId,
          count: invites.length,
          invites,
        });
      } catch (error) {
        return errorResponse("Failed to list Discord invites.", {
          guildId,
          error: errorText(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_list_emojis",
    {
      description: "List emojis in a Discord guild.",
      inputSchema: guildIdSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ guildId }) => {
      try {
        const guild = await discord.getGuild(guildId);
        const emojis = [...(await guild.emojis.fetch()).values()].map(mapEmoji);
        return successResponse(`Found ${emojis.length} emoji(s).`, {
          guildId,
          count: emojis.length,
          emojis,
        });
      } catch (error) {
        return errorResponse("Failed to list Discord emojis.", {
          guildId,
          error: errorText(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_list_stickers",
    {
      description: "List stickers in a Discord guild.",
      inputSchema: guildIdSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ guildId }) => {
      try {
        const guild = await discord.getGuild(guildId);
        const stickers = [...(await guild.stickers.fetch()).values()].map(mapSticker);
        return successResponse(`Found ${stickers.length} sticker(s).`, {
          guildId,
          count: stickers.length,
          stickers,
        });
      } catch (error) {
        return errorResponse("Failed to list Discord stickers.", {
          guildId,
          error: errorText(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_list_application_commands",
    {
      description: "List guild application commands.",
      inputSchema: guildIdSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ guildId }) => {
      try {
        const guild = await discord.getGuild(guildId);
        const commands = [...(await guild.commands.fetch()).values()].map(
          mapApplicationCommand,
        );
        return successResponse(`Found ${commands.length} application command(s).`, {
          guildId,
          count: commands.length,
          commands,
        });
      } catch (error) {
        return errorResponse("Failed to list Discord application commands.", {
          guildId,
          error: errorText(error),
        });
      }
    },
  );
}
