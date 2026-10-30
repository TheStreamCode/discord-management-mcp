# Configuration

Configuration is loaded from the process environment first, then from `.env.local` in the working directory. Boolean values accept `true/false`, `yes/no`, `on/off`, or `1/0`. For the full first-run walkthrough, including creating the bot and inviting it, see [setup and first use](setup.md).

## Variables

| Variable | Default | Description |
| --- | --- | --- |
| `DISCORD_TOKEN` | Required | Discord bot token from Developer Portal > Bot > Token. |
| `BACKUP_DIR` | `backups` | Relative directory used for local JSON backups. Absolute paths, paths outside the project, and symlinked or junctioned directory components are rejected; real paths must stay inside the project root. |
| `LOG_LEVEL` | `info` | Stderr log level: `error`, `warn`, `info`, or `debug`. Invalid values are rejected at startup. |
| `ENABLE_MESSAGE_CONTENT` | `false` | Enables message-content reading tools. Requires the Discord Message Content privileged intent. |
| `ENABLE_GUILD_MEMBERS` | `false` | Enables the Guild Members gateway intent for workflows that require it. |

## Example

```dotenv
DISCORD_TOKEN=your_bot_token_here
LOG_LEVEL=info
BACKUP_DIR=backups
ENABLE_MESSAGE_CONTENT=false
ENABLE_GUILD_MEMBERS=false
```

## Token Format

Use the Bot Token. Do not use:

- Application ID
- Public Key
- OAuth2 client secret
- Webhook URL

The server rejects values that look like Discord application public keys, and it never prints the token in logs or tool output.

## Logging

`LOG_LEVEL` controls the server logger. Accepted values are `error`, `warn`, `info`, and `debug`; the default is `info`.

Logs are JSON lines written to stderr. Stdout is reserved for MCP protocol traffic, so a client that captures stdout still parses the protocol correctly. Log messages are redacted before they are written and never include the bot token.

Set `LOG_LEVEL=debug` while diagnosing a tool call, and `LOG_LEVEL=error` when a host wants quiet logs.

## Message Content

To read channel message content:

1. Enable **Message Content Intent** in Discord Developer Portal > Application > Bot > Privileged Gateway Intents.
2. Set `ENABLE_MESSAGE_CONTENT=true`.
3. Restart the MCP server.

Without both steps, Discord can return empty `content`, `embeds`, and `attachments` fields.

## Guild Members Intent

`ENABLE_GUILD_MEMBERS=true` requests the Guild Members privileged intent. Enable the matching intent in the Discord Developer Portal before turning it on; without both, member listing and member search calls fail.

## Privileged Intent Review

Discord reviews privileged intent usage once an app reaches 10,000 users. This threshold replaced the former 100-server rule on 2026-06-10. Approved apps must reapply for access annually.

Plan for review time before a large deployment. The server cannot bypass or shorten the review, and the intents stay opt-in and disabled by default.
