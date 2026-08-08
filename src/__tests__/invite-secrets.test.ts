import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, test } from "vitest";
import type { ServerConfig } from "../config.js";
import type { DiscordClientManager } from "../discordClient.js";
import { registerGuildTools } from "../tools/guildTools.js";
import { registerServerConfigTools } from "../tools/serverConfigTools.js";

describe("invite secret handling", () => {
  test("omits invite codes and URLs from list and create responses", async () => {
    const invite = {
      code: "invite-secret",
      url: "https://discord.gg/invite-secret",
      guild: { id: "12345678901234567" },
      channel: { id: "22345678901234567" },
      inviter: { id: "32345678901234567" },
      uses: 1,
      maxUses: 10,
      maxAge: 3_600,
      temporary: false,
      createdAt: new Date("2026-08-08T12:00:00.000Z"),
      expiresAt: new Date("2026-08-08T13:00:00.000Z"),
    };
    const discord = {
      getGuild: async () => ({ invites: { fetch: async () => new Map([[invite.code, invite]]) } }),
      getClient: async () => ({
        channels: { fetch: async () => ({ createInvite: async () => invite }) },
      }),
    } as unknown as DiscordClientManager;
    const server = new McpServer({ name: "invite-secret-test", version: "1.0.0" });
    const config = { backupDir: "backups" } as ServerConfig;
    registerGuildTools(server, discord, config);
    registerServerConfigTools(server, discord, config);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "invite-secret-test-client", version: "1.0.0" },
      { capabilities: {} },
    );

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const listed = await client.callTool({
        name: "discord_list_invites",
        arguments: { guildId: "12345678901234567" },
      });
      const created = await client.callTool({
        name: "discord_create_invite",
        arguments: {
          channelId: "22345678901234567",
          confirm: true,
          reason: "security regression test",
        },
      });

      for (const result of [listed, created]) {
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain("invite-secret");
        expect(serialized).not.toContain("discord.gg");
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
});
