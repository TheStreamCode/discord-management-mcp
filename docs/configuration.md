# Configuration

Configuration is loaded from process environment first, then `.env.local`.

## Variables

| Variable | Default | Description |
| --- | --- | --- |
| `DISCORD_TOKEN` | Required | Discord bot token from Developer Portal > Bot > Token. |
| `BACKUP_DIR` | `backups` | Relative directory used for local JSON backups. Absolute paths and paths outside the project are rejected. |
| `LOG_LEVEL` | `info` | Reserved for logging controls. |
| `ENABLE_MESSAGE_CONTENT` | `false` | Enables message-content reading tools. Requires the Discord Message Content privileged intent. |
| `ENABLE_GUILD_MEMBERS` | `false` | Enables Guild Members gateway intent for workflows that require it. |

Boolean values accept `true/false`, `yes/no`, `on/off`, or `1/0`.

## Token Format

Use the Bot Token. Do not use:

- Application ID
- Public Key
- OAuth2 client secret
- Webhook URL

The server rejects values that look like Discord application public keys.

## Message Content

To read channel message content:

1. Enable **Message Content Intent** in Discord Developer Portal > Application > Bot > Privileged Gateway Intents.
2. Set `ENABLE_MESSAGE_CONTENT=true`.
3. Restart the MCP server.

Without both steps, Discord can return empty `content`, `embeds`, and `attachments` fields.
