import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, test } from "vitest";
import type { ServerConfig } from "../config.js";
import type { DiscordClientManager } from "../discordClient.js";
import { registerBackupTools } from "../tools/backupTools.js";

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
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
