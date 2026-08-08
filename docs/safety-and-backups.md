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

## High-Impact Destructive Guard

Delete and other high-impact destructive tools require either a backup:

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

`discord_backup_restore_apply` creates a pre-restore backup first and only applies conservative role/channel create and update operations by default; deletes remain opt-in.

Restore stops on the first Discord operation error. Its error response retains the pre-restore backup ID and truthfully reports operations already applied, operations skipped, and the failed operation so operators can assess the partial state before retrying.

Role and channel identity is matched by Discord ID first and by an unambiguous semantic match when cloning across guilds. Restore applies supported positions, parents, and permission overwrites; targets that cannot be mapped safely are reported and left unchanged rather than partially replacing permissions.

Role and channel capture is mandatory. If either core section cannot be read, backup creation fails closed instead of writing a partial snapshot that could provide a false sense of rollback safety. Optional sections remain best-effort and produce structured warnings.

Backup files are treated as untrusted local input. Reads reject symbolic links, oversized files, excessive JSON depth or container sizes, malformed resources, and paths not issued by the backup tools. New and legacy snapshots are recursively sanitized before use: invite codes/URLs, webhook tokens/URLs, authorization fields, and other token or secret fields are removed.
