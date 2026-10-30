import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AuditLogEvent,
  ChannelType,
  PermissionFlagsBits,
  PermissionsBitField,
} from "discord.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { emptySnapshotCoverage, type Snapshot } from "../backup/schema.js";
import { writeSnapshot } from "../backup/store.js";
import type { ServerConfig } from "../config.js";
import type { DiscordClientManager } from "../discordClient.js";
import { registerChannelTools } from "../tools/channelTools.js";
import { registerGuildTools } from "../tools/guildTools.js";
import { registerModerationTools } from "../tools/moderationTools.js";
import { registerRoleTools } from "../tools/roleTools.js";
import { registerServerConfigTools } from "../tools/serverConfigTools.js";

const GUILD_ID = "12345678901234567";
const USER_ID = "22345678901234567";
const CHANNEL_ID = "32345678901234567";

type Registrar = (
  server: McpServer,
  discord: DiscordClientManager,
  config: ServerConfig,
) => void;

async function withTool<T>(
  registrar: Registrar,
  discord: unknown,
  fn: (client: Client) => Promise<T>,
  config: Partial<ServerConfig> = {},
): Promise<T> {
  const server = new McpServer({ name: "drift-tools-test", version: "1.0.0" });
  const resolvedConfig = {
    backupDir: "backups",
    enableMessageContent: false,
    enableGuildMembers: false,
    ...config,
  } as ServerConfig;
  registrar(server, discord as DiscordClientManager, resolvedConfig);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "drift-tools-test-client", version: "1.0.0" },
    { capabilities: {} },
  );

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

function snapshot(): Snapshot {
  return {
    schemaVersion: 2,
    capturedAt: "2026-10-30T12:00:00.000Z",
    coverage: emptySnapshotCoverage(),
    guild: {
      id: GUILD_ID,
      name: "Guild",
      icon: null,
      ownerId: null,
      preferredLocale: "en-US",
      verificationLevel: 1,
      defaultMessageNotifications: 0,
      explicitContentFilter: 0,
      features: [],
    },
    warnings: [],
    roles: [],
    channels: [],
    autoModRules: [],
    scheduledEvents: [],
  };
}

function auditGuild(overrides: Record<string, unknown> = {}) {
  const entry = {
    id: "1",
    action: AuditLogEvent.ChannelCreate,
    actionType: "Create",
    targetId: CHANNEL_ID,
    targetType: "Channel",
    executorId: USER_ID,
    reason: "audit regression",
    createdAt: new Date("2026-10-30T12:00:00.000Z"),
    changes: [{ key: "name", old: "old", new: "new" }],
  };

  return {
    members: {
      fetchMe: async () => ({
        permissions: new PermissionsBitField(PermissionFlagsBits.ViewAuditLog),
      }),
    },
    fetchAuditLogs: vi.fn(async () => ({ entries: new Map([[entry.id, entry]]) })),
    ...overrides,
  };
}


describe("new drift tools", () => {
  test("discord_list_audit_log returns mapped entries and applies bounded filters", async () => {
    const guild = auditGuild();
    const discord = { getGuild: async () => guild };

    await withTool(registerGuildTools, discord, async (client) => {
      const result = await client.callTool({
        name: "discord_list_audit_log",
        arguments: { guildId: GUILD_ID, limit: 5, actionType: "ChannelCreate", userId: USER_ID },
      });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({
        ok: true,
        guildId: GUILD_ID,
        count: 1,
        limit: 5,
        entries: [{
          id: "1",
          actionType: "Create",
          targetId: CHANNEL_ID,
          executorId: USER_ID,
          changes: [{ key: "name", old: "old", new: "new" }],
        }],
      });
      expect(guild.fetchAuditLogs).toHaveBeenCalledWith(expect.objectContaining({
        limit: 5,
        type: AuditLogEvent.ChannelCreate,
        user: USER_ID,
      }));
    });
  });

  test("discord_list_audit_log rejects out-of-bounds limits and malformed snowflakes", async () => {
    const discord = { getGuild: async () => auditGuild() };

    await withTool(registerGuildTools, discord, async (client) => {
      for (const args of [
        { guildId: GUILD_ID, limit: 101 },
        { guildId: GUILD_ID, userId: "not-a-snowflake" },
        { guildId: GUILD_ID, before: USER_ID, after: USER_ID },
      ]) {
        const result = await client.callTool({ name: "discord_list_audit_log", arguments: args });
        expect(result.isError, JSON.stringify(args)).toBe(true);
      }
    });
  });

  test("discord_list_role_member_counts returns counts sorted by members", async () => {
    const guild = {
      roles: {
        fetchMemberCounts: async () => new Map([["1", 5], ["2", 12]]),
      },
    };

    await withTool(registerRoleTools, { getGuild: async () => guild }, async (client) => {
      const result = await client.callTool({
        name: "discord_list_role_member_counts",
        arguments: { guildId: GUILD_ID },
      });

      expect(result.structuredContent).toMatchObject({
        ok: true,
        count: 2,
        totalRoleAssignments: 17,
        roles: [
          { roleId: "2", memberCount: 12 },
          { roleId: "1", memberCount: 5 },
        ],
      });
    });
  });

  test("discord_list_bans lists bans and rejects conflicting cursors", async () => {
    const bans = new Map([[USER_ID, {
      user: { id: USER_ID, username: "user", globalName: null, discriminator: "0", bot: false },
      reason: "raid",
    }]]);
    const guild = { bans: { fetch: vi.fn(async () => bans) } };

    await withTool(registerModerationTools, { getGuild: async () => guild }, async (client) => {
      const listed = await client.callTool({
        name: "discord_list_bans",
        arguments: { guildId: GUILD_ID, limit: 10 },
      });
      expect(listed.structuredContent).toMatchObject({
        ok: true,
        count: 1,
        bans: [{ userId: USER_ID, username: "user", reason: "raid" }],
      });

      const conflict = await client.callTool({
        name: "discord_list_bans",
        arguments: { guildId: GUILD_ID, before: USER_ID, after: USER_ID },
      });
      expect(conflict.isError).toBe(true);
      expect(String(conflict.structuredContent?.error)).toContain("mutually exclusive");
    });
  });

  test("discord_search_members requires the opt-in intent and returns matches", async () => {
    const member = {
      id: USER_ID,
      guild: { id: GUILD_ID },
      user: { id: USER_ID, username: "user", discriminator: "0", globalName: null, bot: false, system: false },
      nickname: null,
      roles: { cache: new Map() },
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
      premiumSince: null,
      pending: false,
      communicationDisabledUntil: null,
    };
    const guild = { members: { search: vi.fn(async () => new Map([[USER_ID, member]])) } };
    const discord = { getGuild: async () => guild };

    await withTool(registerGuildTools, discord, async (client) => {
      const disabled = await client.callTool({
        name: "discord_search_members",
        arguments: { guildId: GUILD_ID, query: "us" },
      });
      expect(disabled.isError).toBe(true);
      expect(disabled.structuredContent).toMatchObject({ guildMembersEnabled: false });


    });

    await withTool(registerGuildTools, discord, async (client) => {
      const result = await client.callTool({
        name: "discord_search_members",
        arguments: { guildId: GUILD_ID, query: "us", limit: 10 },
      });
      expect(result.structuredContent).toMatchObject({
        ok: true,
        count: 1,
        members: [{ id: USER_ID, nickname: null }],
      });
    }, { enableGuildMembers: true });
  });

  test("discord_set_incident_actions enforces the 24 hour window and needs no backup", async () => {
    const setIncidentActions = vi.fn(async (options: Record<string, unknown>) => ({
      invitesDisabledUntil: options.invitesDisabledUntil as Date,
      dmsDisabledUntil: null,
    }));
    const guild = { setIncidentActions };

    await withTool(registerServerConfigTools, { getGuild: async () => guild }, async (client) => {
      const until = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
      const result = await client.callTool({
        name: "discord_set_incident_actions",
        arguments: { guildId: GUILD_ID, invitesDisabledUntil: until, confirm: true, reason: "raid" },
      });
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({
        ok: true,
        actions: { invitesDisabledUntil: until, dmsDisabledUntil: null },
      });

      const tooFar = new Date(Date.now() + 25 * 60 * 60 * 1_000).toISOString();
      const rejected = await client.callTool({
        name: "discord_set_incident_actions",
        arguments: { guildId: GUILD_ID, invitesDisabledUntil: tooFar, confirm: true, reason: "raid" },
      });
      expect(rejected.isError).toBe(true);
      expect(String(rejected.structuredContent?.error)).toContain("at most 24 hours");

      const cleared = await client.callTool({
        name: "discord_set_incident_actions",
        arguments: { guildId: GUILD_ID, invitesDisabledUntil: null, confirm: true, reason: "recover" },
      });
      expect(cleared.isError).toBeUndefined();
    });
  });

  test("discord_bulk_ban_members requires the backup guard and reports banned/failed users", async () => {
    const bulkCreate = vi.fn(async () => ({
      bannedUsers: [USER_ID],
      failedUsers: ["33345678901234567"],
    }));
    const guild = { bans: { bulkCreate } };
    const discord = { getGuild: async () => guild };

    await withTool(registerModerationTools, discord, async (client) => {
      const unguarded = await client.callTool({
        name: "discord_bulk_ban_members",
        arguments: { guildId: GUILD_ID, userIds: [USER_ID], confirm: true, reason: "raid" },
      });
      expect(unguarded.isError).toBe(true);
      expect(String(unguarded.structuredContent?.error)).toContain("backupId or allowWithoutBackup");

      const bounds = await client.callTool({
        name: "discord_bulk_ban_members",
        arguments: {
          guildId: GUILD_ID,
          userIds: Array.from({ length: 201 }, (_, index) => `${index + 1}`.padStart(17, "1")),
          confirm: true,
          reason: "raid",
        },
      });
      expect(bounds.isError).toBe(true);

      const banned = await client.callTool({
        name: "discord_bulk_ban_members",
        arguments: {
          guildId: GUILD_ID,
          userIds: [USER_ID],
          deleteMessageSeconds: 60,
          allowWithoutBackup: true,
          confirm: true,
          reason: "raid",
        },
      });
      expect(banned.isError).toBeUndefined();
      expect(banned.structuredContent).toMatchObject({
        ok: true,
        requestedCount: 1,
        banned: [USER_ID],
        failed: ["33345678901234567"],
      });
      expect(bulkCreate).toHaveBeenCalledWith([USER_ID], expect.objectContaining({
        deleteMessageSeconds: 60,
        reason: "raid",
      }));
    });
  });

  test("discord_bulk_ban_members verifies a real backup belongs to the target guild", async () => {
    const backupDir = await mkdtemp(join(tmpdir(), "discord-bulk-ban-"));
    const backupId = await writeSnapshot(backupDir, snapshot(), new Date("2026-10-30T12:00:00.000Z"));
    const bulkCreate = vi.fn(async () => ({ bannedUsers: [USER_ID], failedUsers: [] }));

    try {
      await withTool(
        registerModerationTools,
        { getGuild: async () => ({ bans: { bulkCreate } }) },
        async (client) => {
          const result = await client.callTool({
            name: "discord_bulk_ban_members",
            arguments: {
              guildId: GUILD_ID,
              userIds: [USER_ID],
              backupId,
              confirm: true,
              reason: "raid",
            },
          });
          expect(result.isError).toBeUndefined();
          expect(bulkCreate).toHaveBeenCalledOnce();
        },
        { backupDir },
      );
    } finally {
      await rm(backupDir, { recursive: true, force: true });
    }
  });

  test("discord_set_voice_channel_status PUTs the raw route and can clear the status", async () => {
    const put = vi.fn(async () => undefined);
    const channel = {
      id: CHANNEL_ID,
      guildId: GUILD_ID,
      name: "Voice",
      type: ChannelType.GuildVoice,
      manageable: true,
      edit: vi.fn(),
      permissionOverwrites: { edit: vi.fn() },
    };
    const discord = {
      getClient: async () => ({ rest: { put }, channels: { fetch: async () => channel } }),
    };

    await withTool(registerChannelTools, discord, async (client) => {
      const updated = await client.callTool({
        name: "discord_set_voice_channel_status",
        arguments: { channelId: CHANNEL_ID, status: "Game night", confirm: true, reason: "announce" },
      });
      expect(updated.isError).toBeUndefined();
      expect(updated.structuredContent).toMatchObject({ ok: true, status: "Game night", cleared: false });
      expect(put).toHaveBeenCalledWith(`/channels/${CHANNEL_ID}/voice-status`, expect.objectContaining({
        body: { status: "Game night" },
      }));

      const cleared = await client.callTool({
        name: "discord_set_voice_channel_status",
        arguments: { channelId: CHANNEL_ID, status: null, confirm: true, reason: "announce" },
      });
      expect(cleared.structuredContent).toMatchObject({ ok: true, status: null, cleared: true });

      const tooLong = await client.callTool({
        name: "discord_set_voice_channel_status",
        arguments: { channelId: CHANNEL_ID, status: "x".repeat(501), confirm: true, reason: "announce" },
      });
      expect(tooLong.isError).toBe(true);
    });
  });

  test("channel mutations accept discord.js manageability instead of the removed editable getter", async () => {
    const edit = vi.fn(async () => ({
      id: CHANNEL_ID,
      name: "General",
      guildId: GUILD_ID,
      type: ChannelType.GuildText,
    }));
    const channel = {
      id: CHANNEL_ID,
      guildId: GUILD_ID,
      name: "General",
      type: ChannelType.GuildText,
      manageable: true,
      edit,
      permissionOverwrites: { edit: vi.fn() },
    };
    const discord = {
      getClient: async () => ({ channels: { fetch: async () => channel } }),
    };

    await withTool(registerChannelTools, discord, async (client) => {
      const updated = await client.callTool({
        name: "discord_update_channel",
        arguments: { channelId: CHANNEL_ID, topic: "managed by the bot", confirm: true, reason: "test" },
      });

      expect(updated.isError).toBeUndefined();
      expect(updated.structuredContent).toMatchObject({ ok: true, channelId: CHANNEL_ID });
      expect(edit).toHaveBeenCalledOnce();
    });
  });

  test("channel mutations reject channels the bot cannot manage", async () => {
    const channel = {
      id: CHANNEL_ID,
      guildId: GUILD_ID,
      name: "General",
      type: ChannelType.GuildText,
      manageable: false,
      edit: vi.fn(),
      permissionOverwrites: { edit: vi.fn() },
    };
    const discord = {
      getClient: async () => ({ channels: { fetch: async () => channel } }),
    };

    await withTool(registerChannelTools, discord, async (client) => {
      const updated = await client.callTool({
        name: "discord_update_channel",
        arguments: { channelId: CHANNEL_ID, topic: "blocked", confirm: true, reason: "test" },
      });

      expect(updated.isError).toBe(true);
      expect(JSON.stringify(updated.structuredContent)).toContain("missing permissions or hierarchy");
    });
  });

  test("backup guard policy covers set_channel_permissions and update_guild_settings", async () => {
    const channel = {
      id: CHANNEL_ID,
      guildId: GUILD_ID,
      name: "General",
      type: ChannelType.GuildText,
      manageable: true,
      edit: vi.fn(),
      permissionOverwrites: { edit: vi.fn(async () => undefined) },
    };
    const guild = {
      id: GUILD_ID,
      roles: { fetch: async () => ({ id: USER_ID, name: "Role" }) },
      members: { fetch: async () => ({ id: USER_ID }) },
      edit: vi.fn(async () => ({
        id: GUILD_ID,
        name: "Guild",
        description: null,
        verificationLevel: 1,
        explicitContentFilter: 0,
        defaultMessageNotifications: 0,
        preferredLocale: "en-US",
        afkTimeout: 300,
      })),
    };
    const discord = {
      getGuild: async () => guild,
      getClient: async () => ({ channels: { fetch: async () => channel } }),
    };

    await withTool(registerChannelTools, discord, async (client) => {
      const unguarded = await client.callTool({
        name: "discord_set_channel_permissions",
        arguments: {
          channelId: CHANNEL_ID,
          targetId: USER_ID,
          targetType: "role",
          allow: [],
          deny: [],
          confirm: true,
          reason: "permissions test",
        },
      });
      expect(unguarded.isError).toBe(true);
      expect(String(unguarded.structuredContent?.error)).toContain("backupId or allowWithoutBackup");

      const allowed = await client.callTool({
        name: "discord_set_channel_permissions",
        arguments: {
          channelId: CHANNEL_ID,
          targetId: USER_ID,
          targetType: "role",
          allow: [],
          deny: [],
          allowWithoutBackup: true,
          confirm: true,
          reason: "permissions test",
        },
      });
      expect(allowed.isError).toBeUndefined();
      expect(channel.permissionOverwrites.edit).toHaveBeenCalledOnce();
    });

    await withTool(registerServerConfigTools, discord, async (client) => {
      const unguarded = await client.callTool({
        name: "discord_update_guild_settings",
        arguments: { guildId: GUILD_ID, name: "Renamed", confirm: true, reason: "settings test" },
      });
      expect(unguarded.isError).toBe(true);

      const allowed = await client.callTool({
        name: "discord_update_guild_settings",
        arguments: {
          guildId: GUILD_ID,
          name: "Renamed",
          allowWithoutBackup: true,
          confirm: true,
          reason: "settings test",
        },
      });
      expect(allowed.isError).toBeUndefined();
      expect(guild.edit).toHaveBeenCalledOnce();
    });
  });

  test("discord_list_channels reports hidden channel coverage", async () => {
    const channel = {
      id: CHANNEL_ID,
      guildId: GUILD_ID,
      name: "General",
      type: ChannelType.GuildText,
      parentId: null,
      position: 0,
      topic: null,
      nsfw: false,
      rateLimitPerUser: 0,
      permissionOverwrites: { cache: new Map() },
    };
    const hidden = { ...channel, id: "42345678901234567", name: "hidden", flags: 1 << 17 };
    const guild = {
      channels: {
        fetch: async () => new Map([[channel.id, channel], [hidden.id, hidden]]),
        cache: new Map([[channel.id, channel], [hidden.id, hidden]]),
      },
    };

    await withTool(registerGuildTools, { getGuild: async () => guild }, async (client) => {
      const result = await client.callTool({
        name: "discord_list_channels",
        arguments: { guildId: GUILD_ID },
      });

      expect(result.structuredContent).toMatchObject({
        ok: true,
        count: 2,
        hiddenChannelCount: 1,
        coverageComplete: false,
      });
      expect(String(result.structuredContent?.warning)).toContain("cannot view are not captured");
    });
  });

  test("discord_list_guilds turns a sharding requirement into an actionable error", async () => {
    const discord = {
      getClient: async () => ({
        guilds: {
          fetch: async () => {
            throw new Error("This session would have handled too many guilds - Sharding is required.");
          },
        },
      }),
    };

    await withTool(registerGuildTools, discord, async (client) => {
      const result = await client.callTool({ name: "discord_list_guilds", arguments: {} });

      expect(result.isError).toBe(true);
      expect(String(result.structuredContent?.nextStep)).toContain("sharding");
      expect(String(result.structuredContent?.error)).toContain("Sharding is required");
    });
  });

  test("discord_create_scheduled_event preflights the CREATE_EVENTS permission", async () => {
    const guild = {
      members: {
        fetchMe: async () => ({ permissions: new PermissionsBitField(0n) }),
      },
      scheduledEvents: { create: vi.fn() },
    };

    await withTool(registerModerationTools, { getGuild: async () => guild }, async (client) => {
      const result = await client.callTool({
        name: "discord_create_scheduled_event",
        arguments: {
          guildId: GUILD_ID,
          name: "Event",
          scheduledStartTime: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
          entityType: 2,
          channelId: CHANNEL_ID,
          confirm: true,
          reason: "event test",
        },
      });

      expect(result.isError).toBe(true);
      expect(String(result.structuredContent?.error)).toContain("CREATE_EVENTS");
      expect(guild.scheduledEvents.create).not.toHaveBeenCalled();
    });
  });

  test("discord_create_role and discord_update_role accept gradient colors", async () => {
    const create = vi.fn(async () => ({ id: "52345678901234567", name: "Gradient" }));
    const edit = vi.fn(async () => ({ id: "52345678901234567", name: "Gradient" }));
    const liveRole = { id: "52345678901234567", name: "Gradient", managed: false, editable: true, edit };
    const guild = {
      id: GUILD_ID,
      members: {
        fetchMe: async () => ({
          permissions: new PermissionsBitField(PermissionFlagsBits.ManageRoles),
        }),
      },
      roles: {
        create,
        fetch: async (id?: string) => id ? liveRole : new Map([[liveRole.id, liveRole]]),
      },
    };

    await withTool(registerRoleTools, { getGuild: async () => guild }, async (client) => {
      const created = await client.callTool({
        name: "discord_create_role",
        arguments: {
          guildId: GUILD_ID,
          name: "Gradient",
          colors: { primary: 111, secondary: 222 },
          confirm: true,
          reason: "role colors test",
        },
      });
      expect(created.isError).toBeUndefined();
      expect(create).toHaveBeenCalledWith(expect.objectContaining({
        colors: { primaryColor: 111, secondaryColor: 222 },
      }));

      const updated = await client.callTool({
        name: "discord_update_role",
        arguments: {
          guildId: GUILD_ID,
          roleId: liveRole.id,
          colors: { primary: 333, secondary: null },
          confirm: true,
          reason: "role colors test",
        },
      });
      expect(updated.isError).toBeUndefined();
      expect(edit).toHaveBeenCalledWith(expect.objectContaining({
        colors: { primaryColor: 333, secondaryColor: null },
      }));
    });
  });
});
