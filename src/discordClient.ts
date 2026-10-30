import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Guild,
} from "discord.js";
import { safeErrorMessage } from "./errors.js";
import { createLogger, type Logger, type LogLevel } from "./logger.js";

export type DiscordClientOptions = {
  enableMessageContent?: boolean;
  enableGuildMembers?: boolean;
  logLevel?: LogLevel;
  logger?: Logger;
};

const LOGIN_TIMEOUT_MS = 30_000;
const MAX_READY_ATTEMPTS = 2;

/**
 * Gateway close codes that the client cannot recover from by reconnecting.
 * Discord.js stops retrying for these, so the manager must dispose of the dead
 * client and let the next tool call build a fresh one.
 */
const NON_RECOVERABLE_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

export class DiscordClientManager {
  private client: Client | undefined;
  private ready: Promise<Client> | undefined;
  private readonly logger: Logger;

  constructor(
    private readonly token: string,
    private readonly options: DiscordClientOptions = {},
  ) {
    this.logger = options.logger ?? createLogger(options.logLevel ?? "info");
  }

  async getClient(): Promise<Client> {
    for (let attempt = 0; attempt < MAX_READY_ATTEMPTS; attempt += 1) {
      if (this.client?.isReady()) {
        return this.client;
      }

      const pending = this.ready ?? (this.ready = this.connectClient());
      const client = await pending;

      // A disconnect can land between login resolution and this caller using
      // the client. Re-check before handing out a client that is already dead.
      if (client.isReady()) {
        return client;
      }

      this.logger.warn("Discord client is not ready after login; reconnecting.", {
        attempt: attempt + 1,
      });
      await this.resetClient(client);
    }

    throw new Error(
      "Discord client did not become ready after reconnecting. Check DISCORD_TOKEN and network access.",
    );
  }

  async getGuild(guildId: string): Promise<Guild> {
    const client = await this.getClient();
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      throw new Error(`Discord guild not found or inaccessible: ${guildId}`);
    }
    return guild;
  }

  async destroy(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.ready = undefined;

    if (!client) {
      return;
    }

    try {
      await client.destroy();
    } catch (error) {
      this.logger.warn("Failed to destroy the Discord client.", {
        error: safeErrorMessage(error),
      });
    }
  }

  private async connectClient(): Promise<Client> {
    const intents = [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildScheduledEvents,
    ];

    if (this.options.enableMessageContent === true) {
      intents.push(GatewayIntentBits.MessageContent);
    }

    if (this.options.enableGuildMembers === true) {
      intents.push(GatewayIntentBits.GuildMembers);
    }

    const client = new Client({
      intents,
      partials: [Partials.Channel, Partials.Message, Partials.Reaction],
    });
    this.client = client;
    this.attachLifecycleHandlers(client);

    let timeout: NodeJS.Timeout | undefined;
    const ready = new Promise<Client>((resolve, reject) => {
      timeout = setTimeout(() => {
        this.logger.error("Discord client login timed out.", { timeoutMs: LOGIN_TIMEOUT_MS });
        reject(new Error(`Discord client login timed out after ${LOGIN_TIMEOUT_MS}ms.`));
      }, LOGIN_TIMEOUT_MS);
      client.once(Events.ClientReady, () => resolve(client));
      client.once(Events.Error, (error) => reject(error));
    });

    try {
      await Promise.race([ready, client.login(this.token).then(() => ready)]);
      return client;
    } catch (error) {
      this.logger.error("Discord client login failed.", { error: safeErrorMessage(error) });
      await this.resetClient(client);
      throw error;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private attachLifecycleHandlers(client: Client): void {
    // Persistent listeners keep gateway errors observable: an 'error' event
    // without a listener would crash the process with no diagnostic context.
    client.on(Events.Error, (error) => {
      this.logger.error("Discord client error.", { error: safeErrorMessage(error) });
    });

    client.on(Events.ShardError, (error, shardId) => {
      this.logger.error("Discord shard error.", {
        shardId,
        error: safeErrorMessage(error),
      });
    });

    client.on(Events.ShardDisconnect, (event, shardId) => {
      this.logger.warn("Discord shard disconnected.", {
        shardId,
        code: event.code,
        reason: event.reason,
      });

      if (NON_RECOVERABLE_CLOSE_CODES.has(event.code)) {
        this.logger.error(
          "Discord shard disconnected with a non-recoverable close code; resetting the client.",
          { shardId, code: event.code },
        );
        void this.resetClient(client);
      }
    });

    client.on(Events.Invalidated, () => {
      this.logger.error("Discord client was invalidated; a new login is required.");
      void this.resetClient(client);
    });
  }

  private async resetClient(expected: Client): Promise<void> {
    if (this.client !== expected) {
      return;
    }

    this.client = undefined;
    this.ready = undefined;

    try {
      await expected.destroy();
    } catch (error) {
      this.logger.warn("Failed to destroy the Discord client during reset.", {
        error: safeErrorMessage(error),
      });
    }
  }
}
