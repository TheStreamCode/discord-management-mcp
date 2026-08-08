import { ChannelType, type PermissionsBitField } from "discord.js";
import { describe, expect, test, vi } from "vitest";
import type { RestoreOperation, Snapshot } from "../backup/schema.js";
import { applyRestoreOperations } from "../tools/backupTools.js";

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    schemaVersion: 1,
    capturedAt: "2026-05-29T12:34:56.000Z",
    guild: {
      id: "source-guild",
      name: "Source Guild",
      icon: null,
      ownerId: null,
      preferredLocale: "en-US",
      verificationLevel: 1,
      defaultMessageNotifications: 0,
      explicitContentFilter: 0,
      features: [],
    },
    roles: [],
    channels: [],
    autoModRules: [],
    scheduledEvents: [],
    ...overrides,
  };
}

describe("restore apply", () => {
  test("restores role position as part of an update", async () => {
    const edit = vi.fn();
    const liveRole = {
      id: "target-role",
      name: "Member",
      managed: false,
      editable: true,
      edit,
    };
    edit.mockResolvedValue(liveRole);
    const guild = {
      id: "target-guild",
      roles: {
        fetch: vi.fn(async (id?: string) => id ? liveRole : new Map([[liveRole.id, liveRole]])),
      },
      channels: {
        fetch: vi.fn(async () => new Map()),
      },
    };
    const desiredRole = {
      key: "role:member:7:source",
      id: "source-role",
      name: "Member",
      color: 0,
      hoist: false,
      mentionable: false,
      permissions: "1024",
      position: 7,
      managed: false,
    };
    const operation: RestoreOperation = {
      type: "update",
      resource: "role",
      key: "role:member:1:target",
      before: { ...desiredRole, key: "role:member:1:target", id: "target-role", position: 1 },
      after: desiredRole,
      changes: ["position"],
    };

    await applyRestoreOperations(
      guild as never,
      snapshot({ roles: [desiredRole] }),
      [operation],
      { includeDeletes: false, reason: "restore test" },
    );

    expect(edit).toHaveBeenCalledOnce();
    expect(edit.mock.calls[0]?.[0]).toMatchObject({ position: 7, reason: "restore test" });
  });

  test("maps role permission overwrites when restoring across guilds", async () => {
    const channelEdit = vi.fn();
    const liveRole = { id: "target-role", name: "Member" };
    const liveChannel = {
      id: "target-channel",
      name: "general",
      type: ChannelType.GuildText,
      edit: channelEdit,
    };
    channelEdit.mockResolvedValue(liveChannel);
    const guild = {
      id: "target-guild",
      roles: {
        fetch: vi.fn(async () => new Map([[liveRole.id, liveRole]])),
      },
      channels: {
        fetch: vi.fn(async (id?: string) => id ? liveChannel : new Map([[liveChannel.id, liveChannel]])),
        create: vi.fn(),
      },
    };
    const desiredRole = {
      key: "role:member:1:source",
      id: "source-role",
      name: "Member",
      color: 0,
      hoist: false,
      mentionable: false,
      permissions: "1024",
      position: 1,
      managed: false,
    };
    const desiredChannel = {
      key: "channel:general:0:source",
      id: "source-channel",
      name: "general",
      type: ChannelType.GuildText,
      parentKey: null,
      position: 0,
      topic: null,
      nsfw: false,
      rateLimitPerUser: 0,
      permissionOverwrites: [{
        id: "source-role",
        type: "role" as const,
        targetKey: desiredRole.key,
        allow: "1024",
        deny: "0",
      }],
    };
    const operation: RestoreOperation = {
      type: "update",
      resource: "channel",
      key: "channel:general:0:target",
      before: { ...desiredChannel, key: "channel:general:0:target", id: "target-channel" },
      after: desiredChannel,
      changes: ["permissionOverwrites"],
    };

    await applyRestoreOperations(
      guild as never,
      snapshot({ roles: [desiredRole], channels: [desiredChannel] }),
      [operation],
      { includeDeletes: false, reason: "restore test" },
    );

    const options = channelEdit.mock.calls[0]?.[0] as {
      parent: string | null;
      permissionOverwrites: Array<{ id: string; allow: PermissionsBitField }>;
      type?: ChannelType;
    };
    expect(options.parent).toBeNull();
    expect(options.type).toBeUndefined();
    expect(options.permissionOverwrites[0]?.id).toBe("target-role");
    expect(options.permissionOverwrites[0]?.allow.bitfield).toBe(1024n);
  });

  test("reports completed operations when a later restore operation fails", async () => {
    const firstRole = {
      id: "role-1",
      name: "First",
      managed: false,
      editable: true,
      edit: vi.fn(async function () { return firstRole; }),
    };
    const secondRole = {
      id: "role-2",
      name: "Second",
      managed: false,
      editable: true,
      edit: vi.fn(async () => { throw new Error("Discord rejected role edit"); }),
    };
    const guild = {
      id: "source-guild",
      roles: {
        fetch: vi.fn(async (id?: string) => id
          ? new Map([[firstRole.id, firstRole], [secondRole.id, secondRole]]).get(id)
          : new Map([[firstRole.id, firstRole], [secondRole.id, secondRole]])),
      },
      channels: { fetch: vi.fn(async () => new Map()) },
    };
    const desiredRoles = [firstRole, secondRole].map((role, index) => ({
      key: `role:${role.name.toLowerCase()}:${index}:${role.id}`,
      id: role.id,
      name: role.name,
      color: 0,
      hoist: false,
      mentionable: false,
      permissions: "0",
      position: index,
      managed: false,
    }));
    const operations: RestoreOperation[] = desiredRoles.map((role) => ({
      type: "update",
      resource: "role",
      key: role.key,
      before: { ...role, position: role.position + 1 },
      after: role,
      changes: ["position"],
    }));

    const result = await applyRestoreOperations(
      guild as never,
      snapshot({ roles: desiredRoles }),
      operations,
      { includeDeletes: false, reason: "restore test" },
    );

    expect(result.applied).toHaveLength(1);
    expect(result.failed).toMatchObject({ operation: operations[1], error: "Discord rejected role edit" });
  });
});
