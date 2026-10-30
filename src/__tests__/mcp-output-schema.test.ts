import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { ServerConfig } from "../config.js";
import type { DiscordClientManager } from "../discordClient.js";
import { registerBackupTools } from "../tools/backupTools.js";
import { registerChannelTools } from "../tools/channelTools.js";
import { registerGuildTools } from "../tools/guildTools.js";
import { registerModerationTools } from "../tools/moderationTools.js";
import { registerRoleTools } from "../tools/roleTools.js";
import { registerServerConfigTools } from "../tools/serverConfigTools.js";

describe("MCP backup tool output schemas", () => {
  test("accept error structuredContent without hiding the application error", async () => {
    const server = new McpServer({ name: "output-schema-test", version: "1.0.0" });
    const discord = {} as DiscordClientManager;
    const config = { backupDir: "backups" } as ServerConfig;
    registerBackupTools(server, discord, config);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "output-schema-test-client", version: "1.0.0" },
      { capabilities: {} },
    );

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const result = await client.callTool({
        name: "discord_backup_read",
        arguments: { backupId: "../escape.json" },
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({
        backupId: "../escape.json",
        error: "Invalid backupId. Use an ID returned by discord_backup_create or discord_backup_list.",
        ok: false,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("advertises a root object output schema for every registered tool", async () => {
    const server = new McpServer({ name: "all-output-schema-test", version: "1.0.0" });
    const discord = {} as DiscordClientManager;
    const config = { backupDir: "backups" } as ServerConfig;
    registerGuildTools(server, discord, config);
    registerBackupTools(server, discord, config);
    registerChannelTools(server, discord, config);
    registerRoleTools(server, discord, config);
    registerModerationTools(server, discord, config);
    registerServerConfigTools(server, discord, config);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "all-output-schema-test-client", version: "1.0.0" },
      { capabilities: {} },
    );

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const { tools } = await client.listTools();

      expect(tools).toHaveLength(54);
      for (const tool of tools) {
        expect(tool.title, tool.name).toBeTruthy();
        expect(tool.outputSchema, tool.name).toMatchObject({
          type: "object",
          properties: { ok: { type: "boolean" } },
        });
        expect(tool.outputSchema.required, tool.name).toContain("ok");
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("reports a missing backup directory as an empty list, not an error", async () => {
    const missingDir = join(tmpdir(), `discord-output-schema-missing-${process.pid}-${Date.now()}`);
    const server = new McpServer({ name: "backup-list-test", version: "1.0.0" });
    registerBackupTools(server, {} as DiscordClientManager, { backupDir: missingDir } as ServerConfig);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "backup-list-test-client", version: "1.0.0" },
      { capabilities: {} },
    );

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const result = await client.callTool({ name: "discord_backup_list", arguments: {} });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({
        ok: true,
        backupIds: [],
        count: 0,
        backupDirectoryExists: false,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("keeps complete backup payloads out of read responses", async () => {
    const backupDir = await mkdtemp(join(tmpdir(), "discord-output-schema-"));
    const backupId = "2026-08-08T12-00-00-000Z-12345678901234567.json";
    const server = new McpServer({ name: "backup-read-test", version: "1.0.0" });
    const config = { backupDir } as ServerConfig;
    registerBackupTools(server, {} as DiscordClientManager, config);
    await writeFile(join(backupDir, backupId), JSON.stringify({
      schemaVersion: 1,
      capturedAt: "2026-08-08T12:00:00.000Z",
      guild: {
        id: "12345678901234567",
        name: "Private Guild",
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
    }), "utf8");

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "backup-read-test-client", version: "1.0.0" },
      { capabilities: {} },
    );

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const result = await client.callTool({ name: "discord_backup_read", arguments: { backupId } });

      expect(result.structuredContent).toMatchObject({
        ok: true,
        backupId,
        guildId: "12345678901234567",
        snapshotReturned: false,
        coverage: {
          channels: { fetched: 0, cacheSize: 0, hiddenKeys: [], complete: false },
        },
      });
      expect(result.structuredContent).not.toHaveProperty("snapshot");
    } finally {
      await client.close();
      await server.close();
      await rm(backupDir, { recursive: true, force: true });
    }
  });

  test("validates dedicated backup output schemas on error paths", async () => {
    const backupDir = join(tmpdir(), `discord-output-schema-errors-${process.pid}-${Date.now()}`);
    const server = new McpServer({ name: "backup-error-schema-test", version: "1.0.0" });
    const discord = {
      getGuild: async () => {
        throw new Error("Discord guild not found or inaccessible");
      },
    } as unknown as DiscordClientManager;
    registerBackupTools(server, discord, { backupDir } as ServerConfig);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "backup-error-schema-test-client", version: "1.0.0" },
      { capabilities: {} },
    );

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const created = await client.callTool({
        name: "discord_backup_create",
        arguments: { guildId: "12345678901234567" },
      });
      expect(created.isError).toBe(true);
      expect(created.structuredContent).toMatchObject({ ok: false });

      const planned = await client.callTool({
        name: "discord_backup_restore_plan",
        arguments: {
          backupId: "2026-08-08T12-00-00-000Z-12345678901234567.json",
          targetGuildId: "12345678901234567",
        },
      });
      expect(planned.isError).toBe(true);
      expect(planned.structuredContent).toMatchObject({ ok: false });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
