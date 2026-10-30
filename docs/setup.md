# Setup and first use

This guide walks from an empty Discord Developer Portal to a working Discord Management MCP server in an MCP client, then shows the first safe operations. It assumes you are the owner or an administrator of the Discord server you want to manage.

If you only need the environment variables and their defaults, see [configuration](configuration.md). For the full safety model, see [safety and backups](safety-and-backups.md).

## What you need

- A Discord account and a server where you can manage channels, roles, and members.
- Node.js 24 or newer, or any environment where `npx` works.
- An MCP client that supports local stdio servers: Claude Desktop, Claude Code, Cursor, VS Code, Codex, Windsurf, Cline, or another compatible client.
- A dedicated bot application. Never reuse a bot that other automations depend on.

## 1. Create the Discord application and bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and select **New Application**. Give it a clear name, for example `Server Admin Bot`.
2. Open the **Bot** tab and select **Add Bot** if the application has no bot yet.
3. Select **Reset Token**, then **Copy**. This is the bot token. Discord shows it only once.
   - Keep it out of source control, screenshots, tickets, and chat.
   - Do not use the Application ID, the OAuth2 client secret, or the Application Public Key. The server rejects a 64-character hexadecimal value with an explicit message because that is a public key, not a token.
4. Optional, only if you need the related tools, enable privileged intents in the same tab:
   - **Message Content Intent**: required by `discord_list_channel_messages`. Without it Discord returns empty message content.
   - **Server Members Intent**: only for gateway member workflows. Listing members uses REST and works without it.

Privileged intents are opt-in in this server. Since 2026-06-10 Discord reviews privileged intent usage at 10,000 users instead of 100 servers, and approved apps must reapply annually.

## 2. Invite the bot to the server

1. In the Developer Portal open **OAuth2 > URL Generator**.
2. Select the `bot` scope. You do not need `applications.commands` for this server.
3. Select the permissions for the capabilities you want, using the table below as a starting point. Start read-only and add permissions later.
4. Open the generated URL, choose the server, and authorize.
5. **Role hierarchy:** open **Server Settings > Roles** and drag the bot role above any role it must edit. Discord refuses role changes on roles at or above the bot's highest role.

Recommended starting set:

| Capability | Permission | Tools |
| --- | --- | --- |
| Read channels and members | View Channels | every read-only tool |
| Inspect and edit channels | Manage Channels | channel create/update/delete, reorder, permission overwrites, voice status |
| Inspect and edit roles | Manage Roles | role create/update/delete, assign/remove, reorder, role colors |
| Read the audit log | View Audit Log | `discord_list_audit_log` |
| Moderate members | Kick Members, Ban Members, Moderate Members | kick, ban, unban, bulk ban, timeout |
| Clean messages | Manage Messages | `discord_bulk_delete_messages` |
| Manage webhooks and invites | Manage Webhooks, Create Invite | webhook and invite tools |
| Manage events | Manage Events, Create Events | scheduled event tools |
| Read server settings | Manage Server | guild settings, AutoMod rules, incident actions, member counts |

A convenient URL for the full recommended set, replacing `YOUR_APPLICATION_ID`:

```text
https://discord.com/oauth2/authorize?client_id=YOUR_APPLICATION_ID&scope=bot&permissions=9904999900343
```

Administrator (`permissions=8`) also works but grants far more than the server needs. Use it only on a disposable test server.

## 3. Copy the server ID

1. In Discord open **User Settings > Advanced** and enable **Developer Mode**.
2. Right-click the server icon and select **Copy Server ID**. The ID is a 17 to 20 digit number.
3. Keep it: it is the `guildId` argument of every tool and a required input for backups, restore plans, and guild settings.

The bot's application ID in the Developer Portal is a different number and is not a server ID.

## 4. Configure the MCP client

The server runs locally over stdio and reads `DISCORD_TOKEN` from its environment. The recommended configuration for clients that use the `mcpServers` JSON shape:

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

Optional additions inside `env`: `BACKUP_DIR`, `LOG_LEVEL`, `ENABLE_MESSAGE_CONTENT`, `ENABLE_GUILD_MEMBERS`. See [configuration](configuration.md).

Typical registration locations, current as of 2026. Client formats change, so check the client documentation if a path differs:

| Client | Where |
| --- | --- |
| Claude Desktop | `claude_desktop_config.json` in the Claude application data directory |
| Claude Code | register a local stdio server named `discord-management`; use the JSON shape above for the command, arguments, and environment |
| Cursor | `mcp.json`, either user-level or in `.cursor/mcp.json` of the project |
| VS Code | `.vscode/mcp.json`, with a `servers` entry that declares `"type": "stdio"`, the same command, arguments, and environment |
| Codex | `config.toml`, with a `[mcp_servers.discord-management]` table carrying command, arguments, and environment |
| Windsurf | `mcp_config.json` in the Windsurf configuration directory |
| Cline | the MCP settings panel of the extension, using the same `mcpServers` shape |

Alternative without client configuration: run the client from a directory that contains a `.env.local` file with `DISCORD_TOKEN=...`. The server reads the process environment first and `.env.local` second. `.env.local` must never be committed.

If you install globally instead of using `npx`, replace the `command` and `args` with `discord-management-mcp` after `npm install --global discord-management-mcp`.

## 5. Verify the connection

Restart the MCP client, then ask it to call a read-only tool. For example:

```text
Use discord_list_guilds and show me the name and ID of every server you can see.
```

Expected result: a list that includes the server where you invited the bot. If the list is empty, the bot is not in any server, or the token belongs to a different application.

Then check the tool surface and the first backup:

```text
Use discord_get_guild with guildId 123456789012345678, then discord_backup_create
and report the coverage field.
```

A backup ID means the server can read roles and channels and write to `BACKUP_DIR`. Read `coverage.channels.complete` before trusting the snapshot as a rollback point.

## 6. First safe workflow

Do this once on every new server before changing anything:

1. **Inspect**: `discord_list_channels`, `discord_list_roles`, `discord_list_members`, `discord_list_audit_log`.
2. **Backup**: `discord_backup_create`. Keep the returned `backupId`.
3. **Plan a small change**: for example create a category and one test channel.
4. **Verify**: `discord_list_channels` shows the new objects.
5. **Revert**: `discord_backup_restore_plan` with the backup ID, read the operations and the `planHash`, then `discord_backup_restore_apply` with `expectedPlanHash` and `includeDeletes: true`.
6. **Confirm the revert**: list channels and roles again. If the plan reports `NOT_RESTORED` sections, read them before assuming the rollback is complete.

Every mutation requires `confirm: true` and a non-empty `reason`. High-impact operations also require a same-guild `backupId` or an explicit `allowWithoutBackup: true`. The exception is `discord_set_incident_actions`, which stays available during raids.

## 7. Everyday usage examples

Prompts work best when they name the server and the exact intent. Examples:

- Inventory and audit:
  - "List the channels and roles of server 123456789012345678 and tell me which channels are hidden from the bot."
  - "Show the 20 most recent audit log entries, with executor and reason."
  - "Which roles are still assigned to at least one member?"
- Structure changes:
  - "Create a category called `Announcements` and a text channel `news` inside it, then deny `@everyone` Send Messages on it."
  - "Rename the `rules` channel to `guidelines` and update its topic."
- Moderation:
  - "Timeout user 123456789012345678 for 10 minutes, reason: repeated spam."
  - "Bulk ban these 5 user IDs with a one-day message cleanup."
  - "List current bans and the audit log entries for the last day."
- Events and community:
  - "Create a stage event next Friday at 20:00 with a title and description."
  - "Set the voice channel status of the lounge to `Live Q&A at 21:00`."
- Recovery:
  - "Compare the last two backups and summarize what changed."
  - "Plan a restore from backup `<id>` and show me the operations before applying it."

The client decides which tool to call. To make behavior predictable, state the server ID, the object names, and whether you want a plan or an execution.

## 8. Permissions per tool family

| Tool family | Minimum Discord permissions |
| --- | --- |
| Guild, channel, role, member listing | View Channels |
| Audit log | View Audit Log |
| Role counts, bans | View Channels, Ban Members for bans |
| Channel mutations | Manage Channels |
| Permission overwrites | Manage Channels + Manage Roles where a role is the target |
| Role mutations | Manage Roles, and the bot role above the target role |
| Kick, ban, unban, bulk ban | Kick Members, Ban Members |
| Timeout | Moderate Members |
| Bulk message delete | Manage Messages |
| AutoMod rules | Manage Server, Moderate Members |
| Scheduled events | Manage Events, Create Events |
| Webhooks and invites | Manage Webhooks, Create Invite |
| Guild settings, incident actions | Manage Server |
| Backup and restore | the permissions needed for the underlying roles and channels |

Missing permissions surface as actionable tool errors, not silent no-ops.

## 9. Security checklist

- Use a bot dedicated to this server, not a shared integration bot.
- Grant the smallest permission set you need; add capabilities later.
- Keep the token only in the client's environment configuration or in `.env.local`, never in the repository.
- Rotate the token immediately if it appears in a screenshot, chat, ticket, or log.
- Treat backups as sensitive: they describe the server structure. `BACKUP_DIR` stays inside the project and is rejected if a junction or symlink redirects it.
- Use a disposable server for experiments with destructive tools, and keep production changes behind backup plus restore plan.
- Set `LOG_LEVEL` to `warn` or `error` when you do not need diagnostics. Logs are JSON lines on stderr and never contain the token.

## 10. Uninstall and cleanup

1. Remove the `discord-management` entry from the MCP client configuration.
2. Revoke the bot token in Developer Portal > Bot > Reset Token if the bot will no longer be used.
3. Remove the bot from the server: Server Settings > Integrations, or kick it.
4. Delete the local `backups` directory if the snapshots are no longer needed.

The server writes nothing outside its project directory and `BACKUP_DIR`, and it never sends data to a hosted service.
