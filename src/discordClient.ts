import {
  Client,
  Events,
  GatewayIntentBits,
  Guild,
  Partials,
} from "discord.js";

export type DiscordClientOptions = {
  enableMessageContent?: boolean;
  enableGuildMembers?: boolean;
};

export class DiscordClientManager {
  private client: Client | undefined;
  private ready: Promise<Client> | undefined;

  constructor(
    private readonly token: string,
    private readonly options: DiscordClientOptions = {},
  ) {}

  async getClient(): Promise<Client> {
    if (this.client?.isReady()) {
      return this.client;
    }

    if (!this.ready) {
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

      this.client = new Client({
        intents,
        partials: [Partials.Channel, Partials.Message, Partials.Reaction],
      });

      this.ready = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Discord client login timed out."));
        }, 30_000);

        this.client?.once(Events.ClientReady, () => {
          clearTimeout(timeout);
          resolve(this.client!);
        });

        this.client?.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      await this.client.login(this.token);
    }

    return this.ready;
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
    this.client?.destroy();
    this.client = undefined;
    this.ready = undefined;
  }
}
