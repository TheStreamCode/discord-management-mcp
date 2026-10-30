import { describe, expect, test } from "vitest";
import { createSnapshot } from "../backup/snapshot.js";
import { emptySnapshotCoverage, upgradeSnapshotPayload } from "../backup/schema.js";

function collection<T>(items: T[]) {
  return {
    values: () => items.values(),
    map: <R>(callback: (item: T) => R) => items.map(callback),
  };
}

const HIDDEN_CHANNEL_FLAG = 1 << 17;

function role(overrides: Record<string, unknown> = {}) {
  return {
    id: "role-1",
    name: "Member",
    color: 123,
    colors: { primaryColor: 123, secondaryColor: null, tertiaryColor: null },
    hoist: false,
    mentionable: true,
    permissions: { bitfield: 1024n },
    position: 2,
    managed: false,
    icon: null,
    unicodeEmoji: null,
    ...overrides,
  };
}

function guildFixture(overrides: Record<string, unknown> = {}) {
  const textChannel = {
    id: "chan-1",
    name: "General Chat",
    type: 0,
    parentId: "cat-1",
    position: 1,
    rawPosition: 1,
    topic: "hello",
    nsfw: false,
    rateLimitPerUser: 0,
    permissionOverwrites: {
      cache: collection([
        {
          id: "role-1",
          type: 0,
          allow: { bitfield: 1024n },
          deny: { bitfield: 0n },
        },
      ]),
    },
  };
  const category = {
    id: "cat-1",
    name: "Public",
    type: 4,
    parentId: null,
    position: 0,
    rawPosition: 0,
    permissionOverwrites: { cache: collection([]) },
  };
  const voiceChannel = {
    id: "voice-1",
    name: "Voice Lounge",
    type: 2,
    parentId: null,
    position: 2,
    bitrate: 64_000,
    userLimit: 10,
    rtcRegion: "us-west",
    permissionOverwrites: { cache: collection([]) },
  };

  return {
    id: "guild-1",
    name: "Guild",
    icon: null,
    ownerId: "owner-1",
    preferredLocale: "en-US",
    verificationLevel: 1,
    defaultMessageNotifications: 0,
    explicitContentFilter: 2,
    features: ["COMMUNITY"],
    roles: { fetch: async () => collection([role()]) },
    channels: {
      fetch: async () => collection([category, textChannel, voiceChannel]),
      cache: collection([category, textChannel, voiceChannel]),
    },
    autoModerationRules: { fetch: async () => collection([]) },
    scheduledEvents: { fetch: async () => collection([]) },
    fetchWebhooks: async () => {
      throw new Error("missing permission");
    },
    invites: { fetch: async () => collection([{ code: "abc", url: "https://discord.gg/abc", uses: 1 }]) },
    emojis: { fetch: async () => collection([]) },
    stickers: { fetch: async () => collection([]) },
    commands: { fetch: async () => collection([]) },
    ...overrides,
  };
}

describe("backup snapshot", () => {
  test("serializes roles, channels, gradient colors, voice fields, and complete channel coverage", async () => {
    const snapshot = await createSnapshot(
      guildFixture() as never,
      new Date("2026-05-29T12:00:00.000Z"),
    );

    expect(snapshot).toMatchObject({
      schemaVersion: 2,
      capturedAt: "2026-05-29T12:00:00.000Z",
      coverage: {
        channels: { fetched: 3, cacheSize: 3, hiddenKeys: [], complete: true },
      },
      guild: { id: "guild-1", name: "Guild" },
      roles: [{
        key: "role:member:2:role-1",
        id: "role-1",
        permissions: "1024",
        colors: { primary: 123, secondary: null, tertiary: null },
      }],
      channels: [
        { key: "category:public:0:cat-1", id: "cat-1", parentKey: null },
        { key: "channel:general-chat:1:chan-1", id: "chan-1", parentKey: "category:public:0:cat-1" },
        {
          key: "channel:voice-lounge:2:voice-1",
          id: "voice-1",
          bitrate: 64_000,
          userLimit: 10,
          rtcRegion: "us-west",
        },
      ],
      webhooks: [],
      invites: [{ uses: 1 }],
    });
    expect(JSON.stringify(snapshot)).not.toContain("abc");
    expect(JSON.stringify(snapshot)).not.toContain("discord.gg");
    expect(snapshot.channels[1]?.permissionOverwrites).toEqual([
      {
        id: "role-1",
        type: "role",
        targetKey: "role:member:2:role-1",
        allow: "1024",
        deny: "0",
      },
    ]);
    expect(snapshot.warnings?.some((warning) =>
      warning.message.includes("Channels the bot cannot view are not captured"))).toBe(true);
  });

  test("merges cache-only channels and reports obfuscated hidden channels as incomplete coverage", async () => {
    const visible = {
      id: "chan-1",
      name: "General",
      type: 0,
      parentId: null,
      position: 0,
      permissionOverwrites: { cache: collection([]) },
    };
    const hidden = {
      id: "hidden-1",
      name: "hidden",
      type: 0,
      parentId: null,
      position: 3,
      flags: HIDDEN_CHANNEL_FLAG,
      permissionOverwrites: { cache: collection([]) },
    };
    const cacheOnly = {
      id: "cache-1",
      name: "Cache Only",
      type: 0,
      parentId: null,
      position: 2,
      permissionOverwrites: { cache: collection([]) },
    };
    const guild = guildFixture({
      channels: {
        fetch: async () => collection([visible]),
        cache: collection([visible, cacheOnly, hidden]),
      },
    });

    const snapshot = await createSnapshot(guild as never);

    expect(snapshot.channels.map((channel) => channel.id)).toEqual(["chan-1", "cache-1"]);
    expect(snapshot.coverage.channels).toEqual({
      fetched: 1,
      cacheSize: 3,
      hiddenKeys: ["channel:hidden:3:hidden-1"],
      complete: false,
    });
    expect(snapshot.warnings?.some((warning) =>
      warning.message.includes("1 channel(s) are hidden"))).toBe(true);
  });

  test("excludes gateway threads from channels and coverage", async () => {
    const visible = {
      id: "chan-1",
      name: "General",
      type: 0,
      parentId: null,
      position: 0,
      permissionOverwrites: { cache: collection([]) },
    };
    const thread = {
      id: "thread-1",
      name: "Announcement thread",
      type: 11,
      parentId: "chan-1",
      position: 0,
      permissionOverwrites: { cache: collection([]) },
    };
    const guild = guildFixture({
      channels: {
        fetch: async () => collection([visible]),
        cache: collection([visible, thread]),
      },
    });

    const snapshot = await createSnapshot(guild as never);

    expect(snapshot.channels.map((channel) => channel.id)).toEqual(["chan-1"]);
    expect(snapshot.coverage.channels).toEqual({
      fetched: 1,
      cacheSize: 1,
      hiddenKeys: [],
      complete: true,
    });
    expect(snapshot.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          section: "channels",
          message: "1 thread(s) were excluded from the channel snapshot; threads are not restored by backup restore.",
        }),
      ]),
    );
  });

  test("never claims complete coverage when the gateway cache is empty", async () => {
    const guild = guildFixture({
      channels: {
        fetch: async () => collection([{ id: "chan-1", name: "General", type: 0, parentId: null, position: 0, permissionOverwrites: { cache: collection([]) } }]),
        cache: collection([]),
      },
    });

    const snapshot = await createSnapshot(guild as never);

    expect(snapshot.coverage.channels.complete).toBe(false);
    expect(snapshot.coverage.channels.cacheSize).toBe(0);
    expect(snapshot.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          section: "channels",
          message: "Channel coverage could not be verified; channels the bot cannot view may be missing.",
        }),
      ]),
    );
  });

  test("upcasts v1 snapshots with default incomplete coverage and leaves v2 payloads untouched", () => {
    const upgraded = upgradeSnapshotPayload({
      schemaVersion: 1,
      capturedAt: "2026-05-29T12:00:00.000Z",
      roles: [],
      channels: [],
    }) as Record<string, unknown>;

    expect(upgraded).toMatchObject({
      schemaVersion: 2,
      coverage: emptySnapshotCoverage(),
    });
    expect(emptySnapshotCoverage().channels).toEqual({
      fetched: 0,
      cacheSize: 0,
      hiddenKeys: [],
      complete: false,
    });

    const current = { schemaVersion: 2, coverage: emptySnapshotCoverage() };
    expect(upgradeSnapshotPayload(current)).toBe(current);
    expect(upgradeSnapshotPayload(null)).toBeNull();
  });

  test("rejects incomplete backups when a required role or channel fetch fails", async () => {
    const guild = {
      roles: { fetch: async () => { throw new Error("missing Manage Roles"); } },
      channels: { fetch: async () => collection([]), cache: collection([]) },
    };

    await expect(createSnapshot(guild as never)).rejects.toThrow(
      "Failed to capture required snapshot section roles",
    );
  });
});
