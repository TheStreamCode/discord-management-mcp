import type { ServerConfig } from "../config.js";
import type { DiscordClientManager } from "../discordClient.js";

export interface ToolContext {
  discord: DiscordClientManager;
  config?: ServerConfig;
}

