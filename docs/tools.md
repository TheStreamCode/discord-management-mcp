# Tool Catalog

All tools use the `discord_` prefix.

## Guild Inventory

- `discord_list_guilds`
- `discord_get_guild`
- `discord_list_channels`
- `discord_get_channel`
- `discord_list_channel_messages`
- `discord_list_roles`
- `discord_get_role`
- `discord_list_members`
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

## Roles

- `discord_create_role`
- `discord_update_role`
- `discord_delete_role`
- `discord_assign_role`
- `discord_remove_role`
- `discord_reorder_roles`

## Moderation

- `discord_timeout_member`
- `discord_kick_member`
- `discord_ban_member`
- `discord_unban_member`
- `discord_bulk_delete_messages`
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

## Safety Notes

- Read-only tools do not require confirmation.
- Mutating tools require `confirm: true` and `reason`.
- Destructive tools require `backupId` or `allowWithoutBackup: true`.
- Backup IDs are validated and destructive guild-targeted actions reject backups from another guild.
