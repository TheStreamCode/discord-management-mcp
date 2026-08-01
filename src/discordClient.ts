import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Guild,
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
      this.ready = this.connectClient();
    }

    return this.ready;
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

    let timeout: NodeJS.Timeout | undefined;
    const ready = new Promise<Client>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("Discord client login timed out.")), 30_000);
      client.once(Events.ClientReady, () => resolve(client));
      client.once(Events.Error, reject);
    });

    try {
      await Promise.race([ready, client.login(this.token).then(() => ready)]);
      return client;
    } catch (error) {
      client.destroy();
      if (this.client === client) {
        this.client = undefined;
        this.ready = undefined;
      }
      throw error;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
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
