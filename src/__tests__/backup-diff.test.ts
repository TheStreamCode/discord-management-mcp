import { describe, expect, test } from "vitest";
import { diffChannels, diffRoles } from "../backup/diff.js";
import type { ChannelSnapshot, PermissionOverwriteSnapshot, RoleSnapshot } from "../backup/schema.js";

function role(overrides: Partial<RoleSnapshot> = {}): RoleSnapshot {
  return {
    key: "role:member",
    id: "1",
    name: "Member",
    color: 0,
    hoist: false,
    mentionable: false,
    permissions: "1024",
    position: 1,
    managed: false,
    ...overrides,
  };
}

function overwrite(overrides: Partial<PermissionOverwriteSnapshot> = {}): PermissionOverwriteSnapshot {
  return {
    id: "role-1",
    type: "role",
    allow: "0",
    deny: "0",
    ...overrides,
  };
}

function channel(overrides: Partial<ChannelSnapshot> = {}): ChannelSnapshot {
  return {
    key: "channel:general",
    id: "10",
    name: "general",
    type: 0,
    parentKey: null,
    position: 0,
    topic: null,
    nsfw: false,
    rateLimitPerUser: 0,
    permissionOverwrites: [],
    ...overrides,
  };
}

describe("backup diff", () => {
  test("reports role create, update, delete, and skip operations by key", () => {
    const before = [
      role({ key: "role:keep", id: "1", name: "Keep" }),
      role({ key: "role:update", id: "2", name: "Old Name" }),
      role({ key: "role:delete", id: "3", name: "Delete Me" }),
      role({ key: "role:managed", id: "4", name: "Bot", managed: true }),
    ];
    const after = [
      role({ key: "role:keep", id: "10", name: "Keep" }),
      role({ key: "role:update", id: "20", name: "New Name" }),
      role({ key: "role:create", id: "30", name: "Create Me" }),
    ];

    expect(diffRoles(before, after)).toEqual([
      { type: "skip", resource: "role", key: "role:keep", reason: "no changes" },
      {
        type: "update",
        resource: "role",
        key: "role:update",
        before: before[1],
        after: after[1],
        changes: ["name"],
      },
      { type: "delete", resource: "role", key: "role:delete", before: before[2] },
      { type: "skip", resource: "role", key: "role:managed", reason: "managed role" },
      { type: "create", resource: "role", key: "role:create", after: after[2] },
    ]);
  });

  test("reports channel parent and overwrite updates", () => {
    const before = [
      channel({
        key: "channel:general",
        parentKey: "category:old",
        permissionOverwrites: [overwrite({ id: "role-1", allow: "1024" })],
      }),
    ];
    const after = [
      channel({
        key: "channel:general",
        parentKey: "category:new",
        permissionOverwrites: [overwrite({ id: "role-1", allow: "2048" })],
      }),
    ];

    expect(diffChannels(before, after)).toEqual([
      {
        type: "update",
        resource: "channel",
        key: "channel:general",
        before: before[0],
        after: after[0],
        changes: ["parentKey", "permissionOverwrites"],
      },
    ]);
  });
});
