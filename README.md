# Discord Management MCP

Safe-by-default Discord management from any MCP client

[![CI](https://github.com/TheStreamCode/discord-management-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/TheStreamCode/discord-management-mcp/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/discord-management-mcp.svg)](https://www.npmjs.com/package/discord-management-mcp)

![Discord Management MCP hero](https://raw.githubusercontent.com/TheStreamCode/discord-management-mcp/main/assets/discord-management-mcp-hero.webp)

Discord Management MCP is a local Model Context Protocol (MCP) server for inspecting and
managing Discord guilds. It runs over stdio, keeps the bot token and backups on the
operator's machine, and places explicit confirmation and rollback guards in front of every
mutation. It is built for server owners and moderators who want agent-driven automation
without handing control to a hosted service. This independently developed project is not
affiliated with, endorsed by, sponsored by, or approved by Discord Inc.

## Install

Run the published package with any MCP client:

```bash
npx --yes discord-management-mcp
```

Install it globally or run it from a source checkout:

```bash
npm install --global discord-management-mcp
discord-management-mcp
```

```bash
git clone https://github.com/TheStreamCode/discord-management-mcp.git
cd discord-management-mcp
npm ci
npm run build
npm start
```

## Quick start

1. Create a Discord application, add a bot, and copy the Bot Token from
   **Developer Portal → Application → Bot → Token**. Do not use an Application ID, Public
   Key, OAuth2 client secret, user token, or selfbot token.
2. Provide `DISCORD_TOKEN` through the MCP client's secure environment configuration, or run
   the client from a directory that contains a local `.env.local` file.
3. Register the server in your MCP client:

   ```json
   {
     "mcpServers": {
       "discord-management": {
         "command": "npx",
         "args": ["--yes", "discord-management-mcp"]
       }
     }
   }
   ```

4. Start with read-only tools, create a local backup, review the restore plan, then confirm a
   mutation with an audit reason:

   ```json
   {
     "guildId": "123456789012345678",
     "confirm": true,
     "reason": "Create the approved community announcements channel"
   }
   ```

   Delete and other high-impact operations also require a guild-matched `backupId` unless the
   operator explicitly accepts `allowWithoutBackup: true`.

## Features

- 47 tools cover guild inventory, channels, roles, moderation, AutoMod, scheduled events,
  webhooks, invites, backups, and restore planning.
- Every mutation requires `confirm: true` and a non-empty audit reason.
- Destructive operations require a guild-matched backup or an explicit operator acknowledgement.
- Read-only tools are annotated and implemented as read-only.
- The bot token, backups, restore plans, and the stdio transport stay on the operator's machine;
  there is no hosted relay and no public HTTP listener.
- Backup capture fails closed on core sections; optional sections emit structured warnings.
- Invite codes, invite URLs, webhook tokens, authorization fields, and recursively detected
  secret fields are removed from snapshots and tool output.
- Restore reports skipped, lossy, applied, and failed operations instead of promising an
  impossible full rollback.

## Requirements

- Node.js 24 or newer.
- A Discord application with a bot token.
- The bot invited to the target guild with only the permissions required for the intended tools.

## Configuration

Configuration is read from the process environment first, then from `.env.local` in the working
directory. Boolean values accept `true`/`false`, `yes`/`no`, `on`/`off`, or `1`/`0`.

| Variable | Purpose | Default |
| --- | --- | --- |
| `DISCORD_TOKEN` | Discord bot token from Developer Portal > Bot > Token | Required |
| `BACKUP_DIR` | Relative directory for local JSON backups; it must stay inside the project directory | `backups` |
| `LOG_LEVEL` | Logging controls | `info` |
| `ENABLE_MESSAGE_CONTENT` | Enables message-content tools and requires the Discord Message Content intent | `false` |
| `ENABLE_GUILD_MEMBERS` | Enables the Guild Members gateway intent for workflows that require it | `false` |

See the [configuration reference](docs/configuration.md) for token rules and privileged-intent
setup.

## Privacy and security

Everything runs locally over stdio: the bot token, backup files, restore plans, and the server
process itself never leave the operator's machine. Mutations are guarded by explicit confirmation
and by backups that are validated for size, depth, structure, and symlinks before planning or
restore. A restore creates a pre-restore backup before its first Discord mutation and stops
truthfully on operation failure. See the [design and trust boundaries](docs/design.md) and
[safety and backups](docs/safety-and-backups.md) for the full model, and `SECURITY.md` for private
vulnerability reporting.

## Troubleshooting

### The server exits because `DISCORD_TOKEN` is missing or invalid

Set the Bot Token in the process environment or in `.env.local` in the working directory. A value
that looks like a Discord Application Public Key is rejected with an explicit message: use the Bot
Token, not the Application ID, Public Key, or OAuth2 client secret.

### Message content comes back empty

Message-content tools need both `ENABLE_MESSAGE_CONTENT=true` and the **Message Content Intent**
enabled in the Discord Developer Portal. Without both, Discord can return empty `content`,
`embeds`, and `attachments` fields. Restart the server after changing either side.

### A mutation is rejected before it reaches Discord

Mutating tools require `confirm: true` and a non-empty `reason`. Delete and other high-impact
destructive tools additionally require a `backupId` from the same guild, or an explicit
`allowWithoutBackup: true` acknowledgement.

### A backup cannot be created or reused

Core role and channel capture fails closed when the bot cannot read those sections; grant the
permissions required by the intended tools. Backups are validated before planning or restore, and
a guild-targeted destructive action rejects a backup captured from another guild.

### Restore reports skipped or lossy operations

Discord cannot recreate original IDs, message or audit-log history, exact invite codes, webhook
tokens, managed integration objects, or every community and discovery setting. Review the restore
plan and the reported operations before retrying.

## Development

Requirements: Node.js 24 or newer and npm from the lockfile.

```bash
git clone https://github.com/TheStreamCode/discord-management-mcp.git
cd discord-management-mcp
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run preflight
npm run pack:check
npm audit --omit=dev --audit-level=high
```

Tests use mocks and must not contact Discord. Live mutations are never part of routine
verification. See `AGENTS.md` for repository conventions.

## Support

See `SUPPORT.md`. Use GitHub Issues for reproducible bugs and feature proposals, and report
vulnerabilities privately through GitHub Security Advisories.

## Contributing

See `CONTRIBUTING.md`. Pull requests must pass `npm run preflight` and the required CI checks.

## License

MIT — see [`LICENSE`](LICENSE). Copyright (c) 2026 Michael Gasperini (Mikesoft).

This independently developed project is not affiliated with, endorsed by, sponsored by, or
approved by Discord Inc. Discord is a trademark of Discord Inc. See [`NOTICE`](NOTICE) for the
applicable Discord terms and policies.

---

Maintained by [Michael Gasperini (Mikesoft)](https://mikesoft.it).
If this project helps you manage Discord communities safely, consider
[sponsoring its maintenance](https://github.com/sponsors/TheStreamCode).
