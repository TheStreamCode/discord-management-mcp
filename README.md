# Discord Management MCP

[![CI](https://github.com/TheStreamCode/discord-management-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/TheStreamCode/discord-management-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/discord-management-mcp.svg)](https://www.npmjs.com/package/discord-management-mcp)
[![node](https://img.shields.io/node/v/discord-management-mcp.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

![Discord Management MCP hero](https://raw.githubusercontent.com/TheStreamCode/discord-management-mcp/main/assets/discord-management-mcp-hero.webp)

Safely inspect and manage Discord guilds from any Model Context Protocol client. Discord Management MCP runs locally over stdio, keeps credentials and backups on your machine, and places explicit confirmation and rollback guards in front of every mutation.

```bash
npx --yes discord-management-mcp
```

No hosted relay. No public HTTP listener. No user tokens or selfbots.

## Why Discord Management MCP?

- **Safe by default:** every mutation requires `confirm: true` and a non-empty audit reason.
- **Rollback-aware:** destructive operations require a guild-matched backup or an explicit operator acknowledgement.
- **Local-first:** the bot token, backup files, restore plans, and stdio transport stay on the operator's machine.
- **Discord-focused:** 47 tools cover inventory, channels, roles, moderation, AutoMod, events, webhooks, invites, backups, and restore planning.
- **Honest recovery:** restore reports skipped, lossy, applied, and failed operations instead of promising an impossible full rollback.

## Quick Start

### 1. Requirements

- Node.js `>=24`
- A Discord application with a bot token
- The bot invited to the target guild with only the permissions required for the intended tools

Create `.env.local` from [`.env.example`](./.env.example):

```dotenv
DISCORD_TOKEN=your_bot_token_here
LOG_LEVEL=info
BACKUP_DIR=backups
ENABLE_MESSAGE_CONTENT=false
ENABLE_GUILD_MEMBERS=false
```

Use the token from **Discord Developer Portal → Application → Bot → Token**. Do not use an Application ID, Public Key, user token, or selfbot token.

### 2. Configure your MCP client

The recommended package-based configuration is:

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

Provide `DISCORD_TOKEN` through the client's secure environment configuration or run the client from a directory containing the local `.env.local` file. Never paste a real token into a shared configuration file.

<details>
<summary>Install globally or run from source</summary>

Install the CLI globally:

```bash
npm install --global discord-management-mcp
discord-management-mcp
```

Run from source with the repository-local toolchain:

```bash
npm ci
npm run build
npm start
```

For a source checkout, configure the MCP command as `node`, point `args` to the absolute `dist/index.js` path, and set `cwd` to the repository root.

</details>

### 3. Start with a safe workflow

```text
Inspect the guild
      ↓
Create a local backup
      ↓
Review the proposed plan
      ↓
Confirm the mutation with an audit reason
      ↓
Verify the result or use the pre-restore backup
```

Example operator request:

```json
{
  "guildId": "123456789012345678",
  "confirm": true,
  "reason": "Create the approved community announcements channel"
}
```

Delete and other high-impact operations additionally require:

```json
{
  "backupId": "2026-08-08T12-34-56-000Z-123456789012345678.json"
}
```

Use `allowWithoutBackup: true` only when you intentionally accept incomplete rollback coverage.

## Safety Architecture

```text
┌─────────────────┐       local stdio       ┌─────────────────────────┐
│   MCP client    │ ──────────────────────▶ │ Discord Management MCP  │
└─────────────────┘                         │                         │
                                            │ Zod input bounds        │
                                            │ confirmation guards     │
                                            │ secret redaction        │
                                            │ backup validation       │
                                            └───────────┬─────────────┘
                                                        │
                                      ┌─────────────────┴──────────────┐
                                      ▼                                ▼
                              local JSON backups                 Discord API
```

Core safety guarantees:

- Read-only tools are annotated and implemented as read-only.
- Mutating tools require explicit confirmation and a human-readable reason.
- Backup IDs are path-safe and destructive guild operations reject cross-guild backups.
- Core role/channel capture fails closed; optional sections produce structured warnings.
- Invite codes, invite URLs, webhook tokens, authorization fields, and recursively detected secret fields are omitted.
- Backup input is size-, depth-, structure-, and symlink-validated before planning or restore.
- A restore creates a pre-restore backup before its first Discord mutation and stops truthfully on operation failure.

## Capabilities

| Area | Examples |
| --- | --- |
| Guild inventory | Guilds, channels, roles, members, messages, emojis, stickers, commands |
| Channel management | Create, update, delete, reorder, and permission overwrites |
| Role management | Create, update, delete, reorder, assign, and remove |
| Moderation | Timeout, kick, ban, unban, and guarded bulk message deletion |
| Discord automation | AutoMod rules and scheduled events |
| Integrations | Non-secret webhook and invite management |
| Backup and restore | Create, list, validate, diff, plan, and conservatively apply |

See the complete [tool catalog](./docs/tools.md).

## Backup And Restore

Backups are bounded, validated JSON snapshots stored in `BACKUP_DIR`. They can contain sensitive guild structure, so they are ignored by Git and should remain private.

`discord_backup_read` validates a snapshot and returns only its guild metadata, capture time, resource counts, and warnings. The full payload remains local; diff, restore planning, and restore apply consume it internally.

Restore is intentionally conservative. Discord cannot recreate original IDs, message or audit-log history, invite codes, webhook tokens, managed integration objects, or every community/discovery setting. Cross-guild permission targets that cannot be mapped safely are preserved and reported rather than guessed.

## Discord Intents

Privileged gateway intents are opt-in:

- `ENABLE_MESSAGE_CONTENT=true` enables `discord_list_channel_messages` and also requires **Message Content Intent** in the Discord Developer Portal.
- `ENABLE_GUILD_MEMBERS=true` enables stronger member-listing behavior and also requires **Guild Members Intent** where Discord enforces it.

If a toggle is enabled locally but disabled in the Developer Portal, Discord can reject login or omit the corresponding data.

## Documentation

- [Configuration](./docs/configuration.md)
- [Tool catalog](./docs/tools.md)
- [Safety and backups](./docs/safety-and-backups.md)
- [Design and trust boundaries](./docs/design.md)
- [Security policy](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md)

## Development

Use the repository-local Node.js toolchain:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run preflight
npm run pack:check
npm audit --omit=dev
```

Tests use mocks and must not contact Discord. Live mutations are never part of routine verification.

## Support

Use [GitHub Issues](https://github.com/TheStreamCode/discord-management-mcp/issues) for reproducible bugs and feature proposals. Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/TheStreamCode/discord-management-mcp/security/advisories/new).

If this project helps you manage Discord communities safely, you can support continued maintenance through [GitHub Sponsors](https://github.com/sponsors/TheStreamCode).

## License

Project-owned code and materials are licensed under the [MIT License](./LICENSE). Copyright © 2026 Michael Gasperini.

This independently developed project is not affiliated with, endorsed by, sponsored by, or approved by Discord Inc. Discord is a trademark of Discord Inc. The MIT License does not grant rights in Discord names, logos, services, branding, APIs, or content. See [NOTICE](./NOTICE) for the applicable Discord terms and policies.
