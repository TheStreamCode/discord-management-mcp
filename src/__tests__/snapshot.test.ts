import { describe, expect, test } from "vitest";
import { createSnapshot } from "../backup/snapshot.js";

function collection<T>(items: T[]) {
  return {
    values: () => items.values(),
    map: <R>(callback: (item: T) => R) => items.map(callback),
  };
}

describe("backup snapshot", () => {
  test("serializes guild roles and channels with stable keys while tolerating optional fetch failures", async () => {
    const guild = {
      id: "guild-1",
      name: "Guild",
      icon: null,
      ownerId: "owner-1",
      preferredLocale: "en-US",
      verificationLevel: 1,
      defaultMessageNotifications: 0,
      explicitContentFilter: 2,
      features: ["COMMUNITY"],
      roles: {
        fetch: async () =>
          collection([
            {
              id: "role-1",
              name: "Member",
              color: 123,
              hoist: false,
              mentionable: true,
              permissions: { bitfield: 1024n },
              position: 2,
              managed: false,
              icon: null,
              unicodeEmoji: null,
            },
          ]),
      },
      channels: {
        fetch: async () =>
          collection([
            {
              id: "cat-1",
              name: "Public",
              type: 4,
              parentId: null,
              position: 0,
              rawPosition: 0,
              permissionOverwrites: { cache: collection([]) },
            },
            {
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
            },
          ]),
      },
      autoModerationRules: { fetch: async () => collection([]) },
      scheduledEvents: { fetch: async () => collection([]) },
      fetchWebhooks: async () => {
        throw new Error("missing permission");
      },
      invites: { fetch: async () => collection([{ code: "abc", uses: 1 }]) },
      emojis: { fetch: async () => collection([]) },
      stickers: { fetch: async () => collection([]) },
      commands: { fetch: async () => collection([]) },
    };

    const snapshot = await createSnapshot(guild as never, new Date("2026-05-29T12:00:00.000Z"));

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      capturedAt: "2026-05-29T12:00:00.000Z",
      guild: { id: "guild-1", name: "Guild" },
      roles: [{ key: "role:member:2:role-1", id: "role-1", permissions: "1024" }],
      channels: [
        { key: "category:public:0:cat-1", id: "cat-1", parentKey: null },
        { key: "channel:general-chat:1:chan-1", id: "chan-1", parentKey: "category:public:0:cat-1" },
      ],
      webhooks: [],
      invites: [{ code: "abc", uses: 1 }],
    });
    expect(snapshot.channels[1]?.permissionOverwrites).toEqual([
      { id: "role-1", type: "role", allow: "1024", deny: "0" },
    ]);
  });
});
