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

## Safety Model

Read-only tools can run without confirmation. Mutating tools require `confirm: true` and a non-empty human-readable `reason`. Destructive tools also require either `backupId` or `allowWithoutBackup: true`. When the target guild is known, destructive guards load the backup and reject it if the backup guild ID does not match the target guild ID.

The MCP never prints the bot token. Errors mention missing/invalid token state without exposing secret values.

Message content reading is disabled by default. When enabled, the operator must also enable the Discord Developer Portal Message Content privileged intent. The server surfaces a clear warning if Discord returns empty content fields.

## Backup Model

Backups are JSON snapshots stored in `backups/`. A snapshot captures guild metadata, roles, channels/categories, permission overwrites, AutoMod rules, scheduled events, webhooks metadata, invites metadata, emojis, stickers, and application command metadata when available.

Restore is best-effort. Discord cannot preserve IDs for deleted/recreated objects, cannot restore message history, and does not expose every server setting. Restore plans report unsupported or lossy operations before apply. Restore apply is intentionally conservative: it creates a pre-restore backup, applies role/channel create and update operations, and only deletes when `includeDeletes: true` is provided.

## Tool Coverage

The first implementation includes:

- Audit: guilds, guild info, channels, channel details, roles, members, AutoMod, scheduled events, webhooks, invites, emojis, stickers, application commands.
- Backup: create, list, read, diff, restore plan, restore apply.
- Channels: create, update, delete, permission overwrites, reorder.
- Roles: create, update, delete, assign/remove role, reorder.
- Moderation: timeout, kick, ban, unban, prune messages where supported.
- Server config: limited guild updates exposed by Discord.
- AutoMod and scheduled events CRUD where Discord permissions allow it.

## Known Limits

Rollback cannot restore original IDs after deletion, exact message history, invite codes, webhook tokens, AutoMod rules, scheduled events, emojis, stickers, application commands, boost/community/discovery settings not exposed by Discord, or time-sensitive states. Role hierarchy can also prevent changes even when the snapshot requests them.
