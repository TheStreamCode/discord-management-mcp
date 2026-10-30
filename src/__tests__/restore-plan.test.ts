import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { emptySnapshotCoverage, type Snapshot } from "../backup/schema.js";
import type { ServerConfig } from "../config.js";
import type { DiscordClientManager } from "../discordClient.js";
import { registerBackupTools } from "../tools/backupTools.js";

const TARGET_GUILD_ID = "12345678901234567";
const BACKUP_ID = "2026-10-30T12-00-00-000Z-12345678901234567.json";

function desiredSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    schemaVersion: 2,
    capturedAt: "2026-10-30T12:00:00.000Z",
    coverage: emptySnapshotCoverage(),
    guild: {
      id: TARGET_GUILD_ID,
      name: "Target Guild",
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
    ...overrides,
  };
}

function desiredRole(overrides: Record<string, unknown> = {}) {
  return {
    key: "role:member:1:source-role",
    id: "target-role",
    name: "Member",
    color: 0,
    colors: { primary: 0, secondary: null, tertiary: null },
    hoist: false,
    mentionable: false,
    permissions: "0",
    position: 1,
    managed: false,
    icon: null,
    unicodeEmoji: null,
    ...overrides,
  };
}

function liveGuild(options: { roleEdit?: ReturnType<typeof vi.fn>; rolesFetch?: () => Promise<unknown> } = {}) {
  const liveRole = {
    id: "target-role",
    name: "Member",
    color: 0,
    colors: { primaryColor: 0, secondaryColor: null, tertiaryColor: null },
    hoist: false,
    mentionable: false,
    permissions: { bitfield: 0n },
    position: 1,
    managed: false,
    icon: null,
    unicodeEmoji: null,
    edit: options.roleEdit ?? vi.fn(),
  };
  const roles = new Map([[liveRole.id, liveRole]]);

  return {
    id: TARGET_GUILD_ID,
    name: "Target Guild",
    icon: null,
    ownerId: null,
    preferredLocale: "en-US",
    verificationLevel: 1,
    defaultMessageNotifications: 0,
    explicitContentFilter: 0,
    features: [],
    roles: {
      fetch: options.rolesFetch ?? (async () => roles),
    },
    channels: {
      fetch: async () => new Map(),
      cache: new Map(),
    },
    autoModerationRules: { fetch: async () => new Map() },
    scheduledEvents: { fetch: async () => new Map() },
    fetchWebhooks: async () => new Map(),
    invites: { fetch: async () => new Map() },
    emojis: { fetch: async () => new Map() },
    stickers: { fetch: async () => new Map() },
    commands: { fetch: async () => new Map() },
  };
}

async function withBackupDir<T>(fn: (backupDir: string) => Promise<T>): Promise<T> {
  const backupDir = await mkdtemp(join(tmpdir(), "discord-restore-plan-"));
  try {
    return await fn(backupDir);
  } finally {
    await rm(backupDir, { recursive: true, force: true });
  }
}

async function callTools(
  backupDir: string,
  guild: unknown,
  calls: (client: Client) => Promise<void>,
): Promise<void> {
  const server = new McpServer({ name: "restore-plan-test", version: "1.0.0" });
  const discord = { getGuild: async () => guild } as unknown as DiscordClientManager;
  registerBackupTools(server, discord, { backupDir } as ServerConfig);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "restore-plan-test-client", version: "1.0.0" },
    { capabilities: {} },
  );

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await calls(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe("restore plan hash and truthfulness", () => {
  test("plan hash is stable, idMap maps source keys, and appends NOT_RESTORED warnings with counts", async () => {
    await withBackupDir(async (backupDir) => {
      const desired = desiredSnapshot({
        roles: [desiredRole()],
        autoModRules: [{
          key: "automod:rule:1:1",
          id: "1",
          name: "Rule",
          enabled: true,
          eventType: 1,
          triggerType: 1,
          triggerMetadata: {},
          actions: [],
          exemptRoleKeys: [],
          exemptChannelKeys: [],
        }],
        webhooks: [{ id: "1", name: "hook" }],
        invites: [{ uses: 1 }, { uses: 2 }],
      });
      await writeFile(join(backupDir, BACKUP_ID), JSON.stringify(desired), "utf8");

      await callTools(backupDir, liveGuild(), async (client) => {
        const first = await client.callTool({
          name: "discord_backup_restore_plan",
          arguments: { backupId: BACKUP_ID, targetGuildId: TARGET_GUILD_ID },
        });
        const second = await client.callTool({
          name: "discord_backup_restore_plan",
          arguments: { backupId: BACKUP_ID, targetGuildId: TARGET_GUILD_ID },
        });

        const plan = first.structuredContent?.plan as {
          planHash: string;
          idMap: Record<string, string>;
          warnings: Array<{ code: string; message: string }>;
          operations: unknown[];
        };
        expect(first.isError).toBeUndefined();
        expect(plan.planHash).toMatch(/^[a-f0-9]{64}$/);
        expect((second.structuredContent?.plan as { planHash: string }).planHash).toBe(plan.planHash);
        expect(plan.idMap["role:member:1:source-role"]).toBe("target-role");
        expect(plan.operations).toEqual([expect.objectContaining({ type: "skip", resource: "role" })]);

        const messages = plan.warnings.map((warning) => warning.message).join("\n");
        expect(plan.warnings.some((warning) => warning.code === "NOT_RESTORED")).toBe(true);
        expect(messages).toContain("1 AutoMod rule(s) were captured");
        expect(messages).toContain("1 webhook(s) were captured");
        expect(messages).toContain("2 invite(s) were captured");
      });
    });
  });

  test("apply rejects an expectedPlanHash mismatch before mutating and keeps preRestoreBackupId", async () => {
    await withBackupDir(async (backupDir) => {
      await writeFile(
        join(backupDir, BACKUP_ID),
        JSON.stringify(desiredSnapshot({ roles: [desiredRole()] })),
        "utf8",
      );
      const roleEdit = vi.fn();

      await callTools(backupDir, liveGuild({ roleEdit }), async (client) => {
        const result = await client.callTool({
          name: "discord_backup_restore_apply",
          arguments: {
            backupId: BACKUP_ID,
            targetGuildId: TARGET_GUILD_ID,
            expectedPlanHash: "0".repeat(64),
            confirm: true,
            reason: "drift regression test",
          },
        });

        expect(result.isError).toBe(true);
        expect(result.structuredContent).toMatchObject({
          ok: false,
          sourceBackupId: BACKUP_ID,
          targetGuildId: TARGET_GUILD_ID,
          applied: [],
          skipped: [],
          failed: null,
          expectedPlanHash: "0".repeat(64),
        });
        expect(result.structuredContent?.preRestoreBackupId).toEqual(expect.any(String));
        expect(String(result.structuredContent?.error)).toContain("Restore plan drift detected");
        expect(roleEdit).not.toHaveBeenCalled();
      });
    });
  });

  test("apply accepts the reviewed plan hash and reports the pre-restore backup id", async () => {
    await withBackupDir(async (backupDir) => {
      await writeFile(
        join(backupDir, BACKUP_ID),
        JSON.stringify(desiredSnapshot({ roles: [desiredRole()], webhooks: [{ id: "1" }] })),
        "utf8",
      );

      await callTools(backupDir, liveGuild(), async (client) => {
        const planned = await client.callTool({
          name: "discord_backup_restore_plan",
          arguments: { backupId: BACKUP_ID, targetGuildId: TARGET_GUILD_ID },
        });
        const planHash = (planned.structuredContent?.plan as { planHash: string }).planHash;

        const applied = await client.callTool({
          name: "discord_backup_restore_apply",
          arguments: {
            backupId: BACKUP_ID,
            targetGuildId: TARGET_GUILD_ID,
            expectedPlanHash: planHash,
            confirm: true,
            reason: "restore hash test",
          },
        });

        expect(applied.isError).toBeUndefined();
        expect(applied.structuredContent).toMatchObject({
          ok: true,
          sourceBackupId: BACKUP_ID,
          targetGuildId: TARGET_GUILD_ID,
          failed: null,
        });
        expect(applied.structuredContent?.preRestoreBackupId).toEqual(expect.any(String));
        const warnings = applied.structuredContent?.warnings as Array<{ code: string }>;
        expect(warnings.some((warning) => warning.code === "NOT_RESTORED")).toBe(true);
        expect(warnings.filter((warning) => warning.code === "LOSSY_RESTORE_LIMITS")).toHaveLength(1);
      });
    });
  });

  test("apply reports preRestoreBackupId as null when it fails before creating the backup", async () => {
    await withBackupDir(async (backupDir) => {
      await writeFile(join(backupDir, BACKUP_ID), JSON.stringify(desiredSnapshot()), "utf8");

      await callTools(backupDir, liveGuild(), async (client) => {
        const result = await client.callTool({
          name: "discord_backup_restore_apply",
          arguments: {
            backupId: BACKUP_ID,
            targetGuildId: "99999999999999999",
            confirm: true,
            reason: "guild mismatch test",
          },
        });

        expect(result.isError).toBe(true);
        expect(result.structuredContent).toMatchObject({
          ok: false,
          preRestoreBackupId: null,
          sourceBackupId: BACKUP_ID,
          targetGuildId: "99999999999999999",
          applied: [],
          skipped: [],
          failed: null,
        });
      });
    });
  });

  test("apply keeps the pre-restore backup id when a restore operation fails", async () => {
    await withBackupDir(async (backupDir) => {
      await writeFile(
        join(backupDir, BACKUP_ID),
        JSON.stringify(desiredSnapshot({ roles: [desiredRole()] })),
        "utf8",
      );
      let calls = 0;
      const guild = liveGuild({
        rolesFetch: async () => {
          calls += 1;
          if (calls > 1) {
            throw new Error("Discord rejected role listing");
          }
          return new Map();
        },
      });

      await callTools(backupDir, guild, async (client) => {
        const result = await client.callTool({
          name: "discord_backup_restore_apply",
          arguments: {
            backupId: BACKUP_ID,
            targetGuildId: TARGET_GUILD_ID,
            confirm: true,
            reason: "failure path test",
          },
        });

        expect(result.isError).toBe(true);
        expect(result.structuredContent?.preRestoreBackupId).toEqual(expect.any(String));
        expect(result.structuredContent?.sourceBackupId).toBe(BACKUP_ID);
        expect(String(result.structuredContent?.error)).toContain("Discord rejected role listing");
      });
    });
  });
});
