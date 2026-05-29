# Safety And Backups

Discord Management MCP is designed around explicit, reviewable changes.

## Mutation Guard

Every mutating tool requires:

```json
{
  "confirm": true,
  "reason": "short audit-log reason"
}
```

The `reason` is passed to Discord where the API supports audit-log reasons.

## Destructive Guard

Destructive tools require either a backup:

```json
{
  "backupId": "2026-05-29T12-34-56-000Z-123456789012345678.json"
}
```

or an explicit opt-out:

```json
{
  "allowWithoutBackup": true
}
```

When the target guild is known, the server reads the backup and rejects it if the backup guild ID does not match the target guild ID.

## Restore Limits

Restore is best-effort. Discord does not allow full restoration of:

- Original IDs after delete/recreate
- Message history
- Audit-log history
- Exact invite codes
- Webhook tokens
- Managed integration-owned roles
- Every community, discovery, or boost-related setting

`discord_backup_restore_apply` creates a pre-restore backup first and only applies conservative role/channel create and update operations by default.
