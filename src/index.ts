#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { DiscordClientManager } from "./discordClient.js";
import { registerBackupTools } from "./tools/backupTools.js";
import { registerChannelTools } from "./tools/channelTools.js";
import { registerGuildTools } from "./tools/guildTools.js";
import { registerModerationTools } from "./tools/moderationTools.js";
import { registerRoleTools } from "./tools/roleTools.js";
import { registerServerConfigTools } from "./tools/serverConfigTools.js";

const config = loadConfig();
const discord = new DiscordClientManager(config.discordToken, {
  enableMessageContent: config.enableMessageContent,
  enableGuildMembers: config.enableGuildMembers,
});

const server = new McpServer({
  name: "discord-management-mcp",
  version: "0.1.0",
});

registerGuildTools(server, discord, config);
registerBackupTools(server, discord, config);
registerChannelTools(server, discord, config);
registerRoleTools(server, discord, config);
registerModerationTools(server, discord, config);
registerServerConfigTools(server, discord, config);

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", async () => {
  await discord.destroy();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await discord.destroy();
  process.exit(0);
});
