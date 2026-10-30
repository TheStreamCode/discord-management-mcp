#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { DiscordClientManager } from "./discordClient.js";
import { safeErrorMessage } from "./errors.js";
import { createLogger, type Logger } from "./logger.js";
import { mutationQueue } from "./mutationQueue.js";
import { registerBackupTools } from "./tools/backupTools.js";
import { registerChannelTools } from "./tools/channelTools.js";
import { registerGuildTools } from "./tools/guildTools.js";
import { registerModerationTools } from "./tools/moderationTools.js";
import { registerRoleTools } from "./tools/roleTools.js";
import { registerServerConfigTools } from "./tools/serverConfigTools.js";

const packageMetadata = createRequire(import.meta.url)("../package.json") as { version: string };

const DEFAULT_DRAIN_TIMEOUT_MS = 10_000;

export const serverInstructions =
  "Discord management server. Read before you mutate: call discord_list_guilds, then list the target resources. " +
  "Every guild mutation requires confirm: true plus a non-empty reason. Deletes and other high-impact operations " +
  "also require a backupId from the same guild, or allowWithoutBackup: true. Create a backup with discord_backup_create " +
  "before risky changes and review discord_backup_restore_plan before discord_backup_restore_apply. " +
  "Read-only tools (list/get/backup_read/diff/restore_plan/audit_log) never mutate anything; do not pass confirm to them. " +
  "Channels the bot cannot view are not captured in backups: check coverage.channels.complete in backup output.";

export type ShutdownTransport = {
  close(): Promise<void>;
  onclose?: () => void;
};

export type ShutdownControllerOptions = {
  transport: ShutdownTransport;
  discord: { destroy(): Promise<void> };
  logger: Logger;
  /** Invoked with 0 after the shutdown sequence completes. */
  exit: (code: number) => void;
  drainTimeoutMs?: number;
};

export type ShutdownController = {
  shutdown(reason: string): Promise<void>;
};

/**
 * Builds the shutdown sequence without owning the process: signal handlers and
 * the actual process.exit live only in the entrypoint path, so tests can drive
 * the sequence with fakes.
 */
export function createShutdownController(options: ShutdownControllerOptions): ShutdownController {
  const drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
  let shutdownPromise: Promise<void> | undefined;

  const shutdown = (reason: string): Promise<void> => {
    // Assign before closing anything: closing the transport fires onclose,
    // which calls shutdown again and must observe the in-progress promise.
    shutdownPromise ??= Promise.resolve().then(() => performShutdown(reason));
    return shutdownPromise;
  };

  async function performShutdown(reason: string): Promise<void> {
    options.logger.warn("Shutting down Discord management MCP server.", { reason });

    try {
      await options.transport.close();
    } catch (error) {
      options.logger.warn("Failed to close the MCP transport.", {
        error: safeErrorMessage(error),
      });
    }

    const drained = await mutationQueue.drain(drainTimeoutMs);

    try {
      await options.discord.destroy();
    } catch (error) {
      options.logger.warn("Failed to destroy the Discord client during shutdown.", {
        error: safeErrorMessage(error),
      });
    }

    if (!drained) {
      // The exit code stays 0 so clients do not treat a slow mutation as a
      // server crash; the machine-readable marker makes the partial shutdown
      // visible to operators.
      options.logger.error("SHUTDOWN_PARTIAL", {
        event: "SHUTDOWN_PARTIAL",
        reason,
        pendingMutations: mutationQueue.depth(),
        drainTimeoutMs,
      });
    }

    await flushStderr();
    options.exit(0);
  }

  return { shutdown };
}

async function startServer(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const discord = new DiscordClientManager(config.discordToken, {
    enableMessageContent: config.enableMessageContent,
    enableGuildMembers: config.enableGuildMembers,
    logger,
  });

  const server = new McpServer(
    {
      name: "discord-management-mcp",
      version: packageMetadata.version,
    },
    {
      instructions: serverInstructions,
    },
  );

  registerGuildTools(server, discord, config);
  registerBackupTools(server, discord, config);
  registerChannelTools(server, discord, config);
  registerRoleTools(server, discord, config);
  registerModerationTools(server, discord, config);
  registerServerConfigTools(server, discord, config);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const controller = createShutdownController({
    transport,
    discord,
    logger,
    exit: (code) => process.exit(code),
  });
  const triggerShutdown = (reason: string): void => {
    void controller.shutdown(reason);
  };

  // server.connect() replaced onclose with the protocol handler; chain it so
  // the MCP session still tears down and the mutation drain also runs.
  const protocolOnClose = transport.onclose;
  transport.onclose = () => {
    protocolOnClose?.();
    triggerShutdown("transport closed");
  };

  process.on("SIGINT", () => triggerShutdown("SIGINT"));
  process.on("SIGTERM", () => triggerShutdown("SIGTERM"));
  process.stdin.on("end", () => triggerShutdown("stdin closed"));

  logger.info("Discord management MCP server is ready.", {
    version: packageMetadata.version,
  });
}

function flushStderr(): Promise<void> {
  return new Promise((resolve) => {
    try {
      process.stderr.write("", () => resolve());
    } catch {
      resolve();
    }
  });
}

function normalizeFileUrl(href: string): string {
  return process.platform === "win32" ? href.toLowerCase() : href;
}

function isEntrypoint(): boolean {
  const invokedScript = process.argv[1];

  if (invokedScript === undefined) {
    return false;
  }

  return (
    normalizeFileUrl(pathToFileURL(path.resolve(invokedScript)).href) ===
    normalizeFileUrl(import.meta.url)
  );
}

if (isEntrypoint()) {
  await startServer();
}
