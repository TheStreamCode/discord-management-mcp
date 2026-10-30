import { describe, expect, test } from "vitest";
import { diffChannels, diffRoles } from "../backup/diff.js";
import { computeRestorePlanHash } from "../backup/schema.js";
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

  test("matches roles by immutable Discord ID when mutable key fields change", () => {
    const before = role({
      key: "role:old-name:1:12345678",
      id: "12345678",
      name: "Old Name",
      position: 1,
    });
    const after = role({
      key: "role:new-name:5:12345678",
      id: "12345678",
      name: "New Name",
      position: 5,
    });

    expect(diffRoles([before], [after])).toEqual([
      {
        type: "update",
        resource: "role",
        key: before.key,
        before,
        after,
        changes: ["name", "position"],
      },
    ]);
  });

  test("matches unique cross-guild resources semantically instead of duplicating them", () => {
    const currentRole = role({ key: "role:member:1:target", id: "target", name: "Member" });
    const desiredRole = role({ key: "role:member:1:source", id: "source", name: "Member" });
    const currentChannel = channel({ key: "channel:general:0:target", id: "target", name: "general" });
    const desiredChannel = channel({ key: "channel:general:0:source", id: "source", name: "general" });

    expect(diffRoles([currentRole], [desiredRole])).toEqual([
      { type: "skip", resource: "role", key: currentRole.key, reason: "no changes" },
    ]);
    expect(diffChannels([currentChannel], [desiredChannel])).toEqual([
      { type: "skip", resource: "channel", key: currentChannel.key, reason: "no changes" },
    ]);
  });

  test("reports gradient role color and voice channel field changes", () => {
    const beforeRole = role({ colors: { primary: 1, secondary: 2, tertiary: null } });
    const afterRole = role({ colors: { primary: 1, secondary: 3, tertiary: null } });
    const beforeChannel = channel({ bitrate: 64_000, userLimit: 5, rtcRegion: "us-west" });
    const afterChannel = channel({ bitrate: 96_000, userLimit: 10, rtcRegion: null });

    expect(diffRoles([beforeRole], [afterRole])).toEqual([
      {
        type: "update",
        resource: "role",
        key: beforeRole.key,
        before: beforeRole,
        after: afterRole,
        changes: ["colors"],
      },
    ]);
    expect(diffChannels([beforeChannel], [afterChannel])).toEqual([
      {
        type: "update",
        resource: "channel",
        key: beforeChannel.key,
        before: beforeChannel,
        after: afterChannel,
        changes: ["bitrate", "userLimit", "rtcRegion"],
      },
    ]);
  });

  test("treats v1 snapshots without v2 fields as unknown instead of clearing live values", () => {
    const v1Role = role();
    const v2Role = role({ colors: { primary: 0, secondary: 7, tertiary: null } });
    const v1Channel = channel();
    const v2Channel = channel({ bitrate: 64_000, userLimit: 0, rtcRegion: "us-west" });

    expect(diffRoles([v2Role], [v1Role])).toEqual([
      { type: "skip", resource: "role", key: v2Role.key, reason: "no changes" },
    ]);
    expect(diffChannels([v2Channel], [v1Channel])).toEqual([
      { type: "skip", resource: "channel", key: v2Channel.key, reason: "no changes" },
    ]);
  });

  test("plan hash is canonical across key ordering and changes with operations", () => {
    const operations = diffRoles(
      [role({ key: "role:a", id: "1", name: "A" })],
      [role({ key: "role:a", id: "1", name: "A", color: 10 })],
    );
    const base = {
      sourceBackupId: "backup.json",
      targetGuildId: "12345678901234567",
      warnings: [{ code: "LOSSY_RESTORE_LIMITS", message: "lossy" }],
    };

    const first = computeRestorePlanHash({ ...base, operations });
    const reordered = computeRestorePlanHash({
      warnings: [{ message: "lossy", code: "LOSSY_RESTORE_LIMITS" }],
      targetGuildId: "12345678901234567",
      sourceBackupId: "backup.json",
      operations: JSON.parse(JSON.stringify(operations)) as typeof operations,
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(reordered).toBe(first);
    expect(computeRestorePlanHash({ ...base, operations: [] })).not.toBe(first);
    expect(computeRestorePlanHash({ ...base, targetGuildId: "99999999999999999", operations })).not.toBe(first);
  });
});
