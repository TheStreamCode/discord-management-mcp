# Discord Management MCP Design

## Goal

Build a local, Node 24-compatible MCP server for Discord server management. The server must be safe by default, use a bot token from local environment configuration, and support JSON backups plus restore planning before risky changes.

## Runtime

- Node 24 only; do not modify Node, nvm, or global packages.
- TypeScript ESM.
- MCP transport: stdio only.
- No Express or public HTTP listener.
- Token source: `DISCORD_TOKEN` from environment or `.env.local`.
- Privileged intents are opt-in via configuration: `ENABLE_MESSAGE_CONTENT` and `ENABLE_GUILD_MEMBERS`.
- Structured JSON logs are written to stderr under `LOG_LEVEL` (`error`, `warn`, `info`, `debug`); stdout carries only MCP protocol traffic.
- Mutating tools run through a shared FIFO mutation queue. Restore apply holds an exclusive slot.
- Shutdown handles SIGINT, SIGTERM, stdin end, and transport close, drains the mutation queue for up to 10 seconds, then destroys the Discord client.

## Safety Model

Read-only tools can run without confirmation. Mutating Discord operations require `confirm: true` and a non-empty human-readable `reason`. `discord_backup_create` only writes a local snapshot and needs no confirmation. The high-impact tools listed in the [guard matrix](tools.md#guard-matrix) also require either `backupId` or `allowWithoutBackup: true`. When the target guild is known, destructive guards load the backup and reject it if the backup guild ID does not match the target guild ID.

`discord_set_incident_actions` is the deliberate exception: it is used during raids and other emergencies, it is reversible, and it does not require a backup.

Restore plans carry a `planHash`; apply rejects an `expectedPlanHash` mismatch before the first Discord mutation. This keeps the reviewed plan and the executed plan tied to the same guild state.

The MCP never prints the bot token. Errors mention missing or invalid token state without exposing secret values. MCP annotations describe actual behavior: read-only tools are read-only, additive tools are non-destructive, and updates or deletes are marked destructive where appropriate.

Message content reading is disabled by default. When enabled, the operator must also enable the Discord Developer Portal Message Content privileged intent. Discord reviews privileged intent usage at 10,000 users after the 2026-06-10 policy change, and approved apps must reapply annually.

## Backup Model

Backups are JSON schema v2 snapshots stored in `backups/`. A snapshot captures guild metadata, roles, channels and categories, permission overwrites, AutoMod rules, scheduled events, webhook metadata, invite metadata, emojis, stickers, and application command metadata when available. Roles and channels are required core sections; capture fails closed if either section is unavailable. Optional sections are best-effort and record structured warnings.

Schema v2 adds:

- `coverage.channels` with `fetched`, `cacheSize`, `hiddenKeys`, and `complete`.
- Role `colors` (`primary`, `secondary`, `tertiary`).
- Channel `bitrate`, `userLimit`, and `rtcRegion`.
- Restore plan `planHash` and `NOT_RESTORED` warnings.

Reads accept v1 snapshots and upcast them to v2. Writes always produce v2.

Backup writes are atomic: the store writes a temporary file in the backup directory, synchronizes it, renames it into place with a Windows retry, and validates the parsed snapshot before returning a backup ID. Backup paths must stay inside the project; directory resolution rejects symlinked or junctioned components and verifies the real path stays inside the project root, and reads reject reparse points.

Discord channel obfuscation affects coverage. Starting 2026-11-16, `GET /guilds/{id}/channels` omits channels the bot cannot view, and gateway payloads can carry obfuscated channel objects. A snapshot therefore records channel coverage and warns when channels are hidden or the cache is empty; `discord_list_channels` reports `hiddenChannelCount`, `coverageComplete`, and a warning.

Restore is best-effort. Discord cannot preserve IDs for deleted or recreated objects, cannot restore message history, and does not expose every server setting. Restore plans report unsupported or lossy operations before apply. Restore apply is intentionally conservative: it creates a pre-restore backup, applies supported role and channel fields including positions, parents, permission overwrites, role colors, and channel audio settings, reports `NOT_RESTORED` warnings, and only deletes when the request provides the opt-in delete flag.

## Tool Coverage

The 0.2.0 release registers 54 tools:

- Guild, member, and audit inventory: guilds, guild info, channels, channel details, messages, roles, members, member search, audit log, AutoMod, scheduled events, webhooks, invites, emojis, stickers, application commands.
- Backup: create, list, read, diff, restore plan, restore apply.
- Channels: create, update, delete, permission overwrites, reorder, voice channel status.
- Roles: create, update, delete, assign or remove a role, reorder, member counts.
- Moderation: timeout, kick, ban, unban, bans listing, bulk delete messages, bulk ban members.
- Server configuration: limited guild updates exposed by Discord, invites, webhooks, incident actions.
- AutoMod and scheduled event CRUD where Discord permissions allow it.

## Distribution And Verification

`package.json` declares `mcpName` `io.github.TheStreamCode/discord-management-mcp`, and the repository ships `server.json` for the MCP registry with matching name, version, npm package, stdio transport, and environment variable metadata. Release checks verify that the package, `server.json`, `CHANGELOG.md`, and `CITATION.cff` agree.

`npm run verify:mcp` starts the built server over stdio with a placeholder token, performs the MCP handshake, and validates the advertised surface: 54 tools, deterministic `tools/list`, titles, descriptions, object input schemas, root-object output schemas that require `ok`, and all four annotation hints. It never calls the Discord API. CI runs it on Linux and Windows, and the publish workflow adds audit, `pack:check`, main-ancestry, and environment gates.

## Known Limits

Rollback cannot restore original IDs after deletion, exact message history, invite codes, webhook tokens, AutoMod rules, scheduled events, emojis, stickers, application commands, boost, community, or discovery settings not exposed by Discord, or time-sensitive states. Channels the bot cannot view are absent from REST responses from 2026-11-16 and may be obfuscated in gateway payloads, so a backup with `coverage.channels.complete: false` is not a complete rollback point. Role hierarchy can also prevent changes even when the snapshot requests them.
