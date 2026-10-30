# Discord Management MCP

Safe-by-default Discord management from any MCP client

[![CI](https://github.com/TheStreamCode/discord-management-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/TheStreamCode/discord-management-mcp/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/discord-management-mcp.svg)](https://www.npmjs.com/package/discord-management-mcp)

![Discord Management MCP hero](https://raw.githubusercontent.com/TheStreamCode/discord-management-mcp/main/assets/discord-management-mcp-hero.webp)

Discord Management MCP is a local Model Context Protocol (MCP) server for inspecting, backing up, and managing Discord guilds. It runs over stdio, keeps the bot token and backup files on the operator's machine, and places confirmation, backup, and restore guards in front of every mutation. The server exposes 54 tools across guild inventory, moderation, roles, channels, server settings, backups, and restore planning.

It works with any MCP client that supports local stdio servers, including Claude Desktop, Claude Code, Cursor, VS Code, Codex, Windsurf, and Cline. This independently developed project is not affiliated with, endorsed by, sponsored by, or approved by Discord Inc.

New to Discord bots? The [setup and first use guide](docs/setup.md) walks through creating the application, inviting the bot with the right permissions, copying the server ID, registering the client, verifying the connection, and running the first safe backup and restore.

## Install

The published package runs with one command:

```bash
npx --yes discord-management-mcp
```

The package is published on npm as `discord-management-mcp` and declares MCP registry metadata for `io.github.TheStreamCode/discord-management-mcp` through `package.json` and `server.json`.

### Register with your client

Every client needs the same command, arguments, and `DISCORD_TOKEN` environment variable. Paste the equivalent of this entry into the client's MCP configuration:

```json
{
  "mcpServers": {
    "discord-management": {
      "command": "npx",
      "args": ["--yes", "discord-management-mcp"],
      "env": {
        "DISCORD_TOKEN": "your_bot_token"
      }
    }
  }
}
```

| Client | Registration |
| --- | --- |
| Claude Desktop | Add the entry above to the MCP servers configuration. |
| Claude Code | Add a local stdio server with the same command and arguments. |
| Cursor | Add the entry above to the MCP configuration. |
| VS Code | Add the same command and arguments in the client's MCP configuration. |
| Codex | Add a stdio server entry with the same command and arguments. |
| Windsurf | Add the entry above to the MCP configuration. |
| Cline | Add the server in the MCP settings panel. |

Claude Desktop, Cursor, Windsurf, and Cline accept the `mcpServers` JSON shape shown above. Clients that use a different configuration schema accept the same `command`, `args`, and `env` values. See each client's own documentation for the exact file or command.

## Set up

The short version, with the full walkthrough in [setup and first use](docs/setup.md):

1. **Create the bot.** Developer Portal > New Application > Bot > Reset Token. That token is the only credential the server needs. Do not use the Application ID, Public Key, or OAuth2 client secret.
2. **Invite it.** OAuth2 > URL Generator > scope `bot` plus the permissions you need. Start with View Channels, Manage Channels, Manage Roles, Manage Server, View Audit Log, and the moderation permissions you plan to use. Then drag the bot role above the roles it must edit.
3. **Copy the server ID.** Enable Developer Mode, right-click the server icon, Copy Server ID. This number is the `guildId` argument, not the bot's application ID.
4. **Register the client.** Use the configuration in [Register with your client](#register-with-your-client) with `DISCORD_TOKEN` in `env`, or put the token in `.env.local` in the working directory.
5. **Verify and back up.** Ask the client to run `discord_list_guilds`, then `discord_backup_create` for your server, and read `coverage.channels.complete`.

Example first request:

```text
Use discord_list_guilds, then discord_backup_create for the server I name, and report the backup ID and coverage.
```

Then change things only through the guarded path: create a backup, review the target objects, apply one small change, and confirm the result. Every mutation needs an audit reason:

```json
{
  "guildId": "123456789012345678",
  "confirm": true,
  "reason": "Create the approved community announcements channel"
}
```

High-impact operations also require a guild-matched `backupId` unless the operator explicitly accepts `allowWithoutBackup: true`. The [tool catalog](docs/tools.md) lists the exact policy for every mutating tool.

## Why this one

Many Discord MCP servers stop at read-only inspection or previewing a change, and some route the bot token through a hosted service. Discord Management MCP executes changes locally, but only through a guard and recovery path:

| Capability | Typical preview-only server | Discord Management MCP |
| --- | --- | --- |
| Read-only inspection | Yes | Yes, 23 read-only tools |
| Execute changes | No | Yes, 31 mutating and moderation tools |
| Local backup before risky changes | Rarely | JSON schema v2 snapshots with channel coverage |
| Restore | No | Plan with plan hash, apply with pre-restore backup |
| Rollback guarantee | Not offered | Best effort, reported honestly with `NOT_RESTORED` warnings |
| Data path | Often hosted | Local stdio only |

What that means in practice:

- **Local by design.** The bot token, snapshots, restore plans, and stdio transport stay on the operator's machine. There is no hosted relay and no public HTTP listener.
- **Preview, then apply.** Backups can be diffed and turned into a restore plan before anything changes, and plans carry a hash that apply can verify.
- **Backup to restore promise.** A risky change can point at a same-guild snapshot; restore apply writes a fresh pre-restore backup before its first Discord mutation.
- **An explicit safety matrix.** Every Discord mutation needs `confirm: true` and a reason. The listed high-impact tools need a same-guild backup. Emergency incident actions stay available without one.
- **Truthful recovery.** Restore reports skipped, lossy, applied, and failed operations instead of promising an impossible full rollback.

## Backup to restore

The recovery path has three steps:

1. `discord_backup_create` writes a JSON snapshot to `BACKUP_DIR` atomically, strips invite codes, webhook tokens, and other secrets, and records channel coverage in `coverage.channels`.
2. `discord_backup_diff` and `discord_backup_restore_plan` show what would change. A plan includes a `planHash` and `NOT_RESTORED` warnings for captured sections that Discord cannot recreate.
3. `discord_backup_restore_apply` can verify an `expectedPlanHash`, creates a pre-restore backup, then applies supported role and channel fields conservatively. Deletes remain opt-in.

Discord cannot restore original IDs after delete and recreate, message or audit-log history, exact invite codes, webhook tokens, or every community and discovery setting. The server reports those limits instead of hiding them. See [safety and backups](docs/safety-and-backups.md) for the full model.

## Tool coverage

The server registers 54 tools. See the [tool catalog](docs/tools.md) for every name and the [guard matrix](docs/tools.md#guard-matrix) for the backup policy.

| Domain | Tools |
| --- | --- |
| Guild, member, and audit inventory | 17 |
| Backups and restore | 6 |
| Channels | 6 |
| Roles | 7 |
| Moderation and AutoMod | 13 |
| Server configuration | 5 |
| **Total** | **54** |

Read-only tools are annotated as read-only and never require confirmation. Mutating Discord tools require `confirm: true` plus a non-empty audit reason, and mutations run through a shared queue so they cannot interleave. `discord_backup_create` only writes a local snapshot and does not require confirmation.

## Safety model

- Every Discord mutation requires `confirm: true` and a non-empty `reason`; the reason is passed to Discord where audit-log reasons are supported.
- High-impact tools require a backup from the same guild, or an explicit `allowWithoutBackup: true` acknowledgement.
- `discord_set_incident_actions` is intentionally exempt: it is used during raids, and its changes are reversible.
- Restore apply creates its own pre-restore backup and retains its ID on every error path.
- Backup writes are atomic, and backup paths are confined to the project directory with symlink and junction rejection.
- Read-only tools are implemented and annotated as read-only.

See [safety and backups](docs/safety-and-backups.md) for the guard matrix, channel coverage, and restore behavior, and [design and trust boundaries](docs/design.md) for the runtime model. Report vulnerabilities privately through `SECURITY.md`.

## Requirements

- Node.js 24 or newer.
- A Discord application with a bot token.
- The bot invited to the target guild with only the permissions required for the intended tools.

`ENABLE_MESSAGE_CONTENT` and `ENABLE_GUILD_MEMBERS` are opt-in and require the matching privileged intents in the Discord Developer Portal. Since 2026-06-10, Discord reviews privileged intent usage at 10,000 users rather than 100 servers, and approved apps must reapply annually. See [configuration](docs/configuration.md) for details.

## Configuration

Configuration is read from the process environment first, then from `.env.local` in the working directory. Boolean values accept `true`/`false`, `yes`/`no`, `on`/`off`, or `1`/`0`.

| Variable | Purpose | Default |
| --- | --- | --- |
| `DISCORD_TOKEN` | Discord bot token from Developer Portal > Bot > Token | Required |
| `BACKUP_DIR` | Relative directory for local JSON backups; it must stay inside the project directory | `backups` |
| `LOG_LEVEL` | Stderr log level: `error`, `warn`, `info`, or `debug`; logs are JSON lines | `info` |
| `ENABLE_MESSAGE_CONTENT` | Enables message-content tools and requires the Discord Message Content intent | `false` |
| `ENABLE_GUILD_MEMBERS` | Enables the Guild Members gateway intent for workflows that require it | `false` |

See the [configuration reference](docs/configuration.md) for token rules, logging behavior, and privileged-intent setup.

## Privacy and security

Everything runs locally over stdio: the bot token, backup files, restore plans, and the server process itself never leave the operator's machine. Mutations are guarded by explicit confirmation and by backups that are validated for size, depth, structure, symlinks, and guild identity before planning or restore. A restore creates a pre-restore backup before its first Discord mutation and stops truthfully on operation failure. See [design and trust boundaries](docs/design.md) and [safety and backups](docs/safety-and-backups.md) for the full model, and `SECURITY.md` for private vulnerability reporting.

## Troubleshooting

### The server exits because `DISCORD_TOKEN` is missing or invalid

Set the Bot Token in the process environment or in `.env.local` in the working directory. A value that looks like a Discord Application Public Key is rejected with an explicit message: use the Bot Token, not the Application ID, Public Key, or OAuth2 client secret.

### Message content comes back empty

Message-content tools need both `ENABLE_MESSAGE_CONTENT=true` and the **Message Content Intent** enabled in the Discord Developer Portal. Without both, Discord can return empty `content`, `embeds`, and `attachments` fields. Restart the server after changing either side. If the app is approaching the review threshold, remember that privileged intent access is reviewed at 10,000 users and must be renewed annually.

### A mutation is rejected before it reaches Discord

Mutating tools require `confirm: true` and a non-empty `reason`. High-impact tools additionally require a `backupId` from the same guild, or an explicit `allowWithoutBackup: true` acknowledgement. `discord_set_incident_actions` is the exception for emergency use. Check the [guard matrix](docs/tools.md#guard-matrix) before retrying.

### Channels are missing from a backup or channel list

The bot can only back up channels it can view. Starting 2026-11-16, Discord omits channels the bot cannot view from `GET /guilds/{id}/channels`, and gateway payloads can carry obfuscated channel objects. Backups record this in `coverage.channels` and warn when coverage is incomplete. Grant `VIEW_CHANNEL` where the channels matter, and treat `complete: false` as a partial rollback point. See [channel coverage and obfuscation](docs/safety-and-backups.md#channel-coverage-and-obfuscation).

### Restore reports skipped or lossy operations

Discord cannot recreate original IDs, message or audit-log history, exact invite codes, webhook tokens, managed integration objects, or every community and discovery setting. Check the plan's `planHash` and its `NOT_RESTORED` warnings, then review the reported operations before retrying.

### Logs are too quiet or too noisy

Set `LOG_LEVEL` to `error`, `warn`, `info`, or `debug`. Logs are JSON lines on stderr, so stdout stays reserved for MCP protocol traffic. Use `debug` while diagnosing a tool call and `error` for quiet hosts.

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
npm run verify:mcp
npm run preflight
npm run pack:check
npm audit --omit=dev --audit-level=high
```

`npm run verify:mcp` starts the built server over stdio with a placeholder token and checks the advertised MCP surface: 54 tools, deterministic tool listing, titles, descriptions, input and output schemas, and annotation hints. It never calls the Discord API.

Tests use mocks and must not contact Discord. Live mutations are never part of routine verification. The repository keeps its engineering guidance in `AGENTS.md`; it is not shipped in the npm package. See `CONTRIBUTING.md` for contribution rules.

## Support

See `SUPPORT.md`. Use GitHub Issues for reproducible bugs and feature proposals, and report vulnerabilities privately through GitHub Security Advisories.

## Contributing

See `CONTRIBUTING.md`. Pull requests must pass `npm run preflight`, `npm run verify:mcp`, and the required CI checks.

## License

MIT, see [`LICENSE`](LICENSE). Copyright (c) 2026 Michael Gasperini (Mikesoft).

This independently developed project is not affiliated with, endorsed by, sponsored by, or approved by Discord Inc. Discord is a trademark of Discord Inc. See [`NOTICE`](NOTICE) for the applicable Discord terms and policies.

---

Maintained by [Michael Gasperini (Mikesoft)](https://mikesoft.it).
If this project helps you manage Discord communities safely, consider
[sponsoring its maintenance](https://github.com/sponsors/TheStreamCode).
