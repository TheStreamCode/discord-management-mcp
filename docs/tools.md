# Tool Catalog

Discord Management MCP exposes 54 tools. All names use the `discord_` prefix.

Read-only tools do not require confirmation. Every mutating Discord tool requires `confirm: true` and a non-empty `reason`; high-impact tools additionally require a same-guild backup unless the operator acknowledges the risk. `discord_backup_create` only writes a local snapshot and does not require confirmation. The [guard matrix](#guard-matrix) lists the exact backup policy for each mutating tool.

## Guild, Member, And Audit Inventory

Read-only tools. They never mutate the guild and do not require confirmation.

- `discord_list_guilds`
- `discord_get_guild`
- `discord_list_channels`
- `discord_get_channel`
- `discord_list_channel_messages`
- `discord_list_roles`
- `discord_get_role`
- `discord_list_members`
- `discord_search_members`
- `discord_list_audit_log`
- `discord_list_automod_rules`
- `discord_list_scheduled_events`
- `discord_list_webhooks`
- `discord_list_invites`
- `discord_list_emojis`
- `discord_list_stickers`
- `discord_list_application_commands`

## Backups And Restore

- `discord_backup_create`
- `discord_backup_list`
- `discord_backup_read`
- `discord_backup_diff`
- `discord_backup_restore_plan`
- `discord_backup_restore_apply`

## Channels

- `discord_create_channel`
- `discord_update_channel`
- `discord_delete_channel`
- `discord_set_channel_permissions`
- `discord_reorder_channels`
- `discord_set_voice_channel_status`

## Roles

- `discord_create_role`
- `discord_update_role`
- `discord_delete_role`
- `discord_assign_role`
- `discord_remove_role`
- `discord_reorder_roles`
- `discord_list_role_member_counts`

## Moderation And AutoMod

Mutations require confirmation. `discord_list_bans` is read-only.

- `discord_list_bans`
- `discord_timeout_member`
- `discord_kick_member`
- `discord_ban_member`
- `discord_unban_member`
- `discord_bulk_delete_messages`
- `discord_bulk_ban_members`
- `discord_create_automod_rule`
- `discord_update_automod_rule`
- `discord_delete_automod_rule`
- `discord_create_scheduled_event`
- `discord_update_scheduled_event`
- `discord_delete_scheduled_event`

## Server Configuration

- `discord_update_guild_settings`
- `discord_create_invite`
- `discord_create_webhook`
- `discord_delete_webhook`
- `discord_set_incident_actions`

## New In 0.2.0

The 0.2.0 release adds these tools. Their limits are enforced by bounded input schemas.

| Tool | Behavior | Bounds |
| --- | --- | --- |
| `discord_list_audit_log` | Reads guild audit log entries with entry changes | `limit` 1-100, optional `actionType`, `userId`, `before`, `after` |
| `discord_list_role_member_counts` | Reads member counts per role | Guild only |
| `discord_list_bans` | Lists guild bans with cursor pagination | Optional `after` or `before` cursor (mutually exclusive), page `limit` 1-1000 |
| `discord_search_members` | Searches members by username or nickname prefix; requires `ENABLE_GUILD_MEMBERS=true` and the Guild Members intent | Query required, `limit` 1-1000 |
| `discord_set_incident_actions` | Sets raid incident actions (invites disabled, DMs disabled) | ISO timestamps or `null`, at most 24 hours ahead |
| `discord_bulk_ban_members` | Bans up to 200 users in one operation | Up to 200 user IDs, optional `deleteMessageSeconds`, returns banned and failed IDs |
| `discord_set_voice_channel_status` | Sets or clears the status text of a voice channel | At most 500 characters, or `null` to clear |

## Guard Matrix

The backup guard is normative. "Required" means the tool rejects the request unless `backupId` refers to a backup captured from the same guild, or the caller explicitly sets `allowWithoutBackup: true`. Every tool that changes Discord, including those without a backup guard, still requires `confirm: true` and a non-empty `reason`. `discord_backup_create` is the only non-read-only tool without a confirmation requirement because it only writes a local file.

| Tool | Effect | Backup guard |
| --- | --- | --- |
| `discord_backup_create` | Creates a local JSON snapshot | Not required |
| `discord_backup_restore_apply` | Applies a restore plan | Not required; creates a pre-restore backup |
| `discord_create_channel` | Creates a channel | Not required |
| `discord_update_channel` | Updates a channel | Not required |
| `discord_delete_channel` | Deletes a channel | Required |
| `discord_set_channel_permissions` | Replaces permission overwrites | Required |
| `discord_reorder_channels` | Reorders channels | Not required |
| `discord_set_voice_channel_status` | Updates voice channel status text | Not required |
| `discord_create_role` | Creates a role | Not required |
| `discord_update_role` | Updates a role | Not required |
| `discord_delete_role` | Deletes a role | Required |
| `discord_assign_role` | Adds a role to a member | Not required |
| `discord_remove_role` | Removes a role from a member | Not required |
| `discord_reorder_roles` | Reorders roles | Not required |
| `discord_timeout_member` | Times out a member | Not required |
| `discord_kick_member` | Kicks a member | Required |
| `discord_ban_member` | Bans a member | Required |
| `discord_unban_member` | Removes a ban | Not required |
| `discord_bulk_delete_messages` | Deletes messages in bulk | Required |
| `discord_bulk_ban_members` | Bans up to 200 users | Required |
| `discord_set_incident_actions` | Enables or clears emergency incident actions | Not required; emergency and reversible |
| `discord_create_automod_rule` | Creates an AutoMod rule | Not required |
| `discord_update_automod_rule` | Updates an AutoMod rule | Not required |
| `discord_delete_automod_rule` | Deletes an AutoMod rule | Required |
| `discord_create_scheduled_event` | Creates a scheduled event | Not required |
| `discord_update_scheduled_event` | Updates a scheduled event | Not required |
| `discord_delete_scheduled_event` | Deletes a scheduled event | Required |
| `discord_update_guild_settings` | Updates guild settings | Required |
| `discord_create_invite` | Creates an invite | Not required |
| `discord_create_webhook` | Creates a webhook | Not required |
| `discord_delete_webhook` | Deletes a webhook | Required |

`discord_set_incident_actions` stays ungated on purpose: it is used during raids and other emergencies, and its changes are reversible. `discord_backup_restore_apply` creates its own pre-restore backup before the first Discord mutation.

## Restore Plans

`discord_backup_restore_plan` returns a plan with a `planHash` derived from the source backup, target guild, operations, and warnings. `discord_backup_restore_apply` accepts an optional `expectedPlanHash`; when the value does not match the freshly computed plan, the tool rejects the request with a drift error before any mutation.

Restore plans and apply results report `NOT_RESTORED` warnings for captured sections that Discord does not let the server recreate or update. Review those warnings before applying a plan.

## Channel Coverage

`discord_backup_create` records channel coverage in `coverage.channels` with `fetched`, `cacheSize`, `hiddenKeys`, and `complete`. `discord_list_channels` returns `hiddenChannelCount`, `coverageComplete`, and a warning when the bot cannot see every channel.

Discord starts omitting channels the bot cannot view from `GET /guilds/{id}/channels` on 2026-11-16, and gateway payloads for those channels can be obfuscated. Coverage metadata makes that limitation explicit instead of silently producing an incomplete backup.

## Safety Notes

- Read-only tools do not require confirmation and are annotated as read-only.
- Mutating Discord tools require `confirm: true` and a non-empty `reason`; the reason is sent to Discord where the API supports audit-log reasons.
- Destructive tools with a backup guard accept `backupId` or `allowWithoutBackup: true`, and backups are validated against the target guild when the guild is known.
- Mutations run through a shared FIFO mutation queue. Restore apply runs in an exclusive slot so it cannot interleave with another mutation.
- `discord_backup_read` validates a local snapshot and returns only metadata, counts, and warnings; the full backup payload is never returned to the MCP client.
- Invite list and create results never return invite codes or URLs. Webhook creation never returns its token-bearing URL.
- Every tool advertises a root-object MCP output schema with an `ok` status; errors retain actionable structured details.
- Update tools reject no-op requests, Discord IDs are bounded snowflakes, and enum inputs must name or equal a real Discord enum member.
- `discord_list_channel_messages` rejects conflicting `before`, `after`, or `around` pagination combinations instead of sending an ambiguous request.
