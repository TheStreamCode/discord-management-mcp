# Safety And Backups

Discord Management MCP is designed around explicit, reviewable changes. This document describes the guards that protect a live guild and the backup model that makes recovery possible.

## Mutation Guard

Every mutating Discord operation requires:

```json
{
  "confirm": true,
  "reason": "short audit-log reason"
}
```

The `reason` is passed to Discord where the API supports audit-log reasons. A missing or empty reason is rejected before the request reaches Discord. `discord_backup_create` is the only non-read-only tool that does not require confirmation, because it only writes a local snapshot.

## Backup Guard

The backup guard is a second, stronger requirement for high-impact operations. Those tools require either a backup:

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

The guard covers deletion of channels, roles, webhooks, AutoMod rules, and scheduled events; member kicks, bans, and bulk bans; bulk message deletion; channel permission replacement; and guild settings updates. `discord_set_incident_actions` is intentionally exempt because it is an emergency, reversible control used during raids. `discord_backup_restore_apply` does not take a backup ID because it creates its own pre-restore backup before the first mutation.

The [guard matrix](tools.md#guard-matrix) is the normative per-tool list.

## Channel Coverage And Obfuscation

Discord is changing how channels are exposed to bots:

- Starting 2026-11-16, `GET /guilds/{id}/channels` omits channels the bot cannot view.
- Gateway payloads for channels the bot cannot view can be obfuscated, including an obfuscated name and the `CHANNEL_OBFUSCATED` channel flag.

A backup therefore reflects what the bot is allowed to see, not everything that exists in the guild. The v2 snapshot records this in `coverage.channels`:

- `fetched`: channels returned by the channel fetch.
- `cacheSize`: channels present in the gateway cache.
- `hiddenKeys`: channels observed as hidden or obfuscated.
- `complete`: `false` when the cache is empty or hidden channels were observed.

`discord_backup_create` always warns that channels without `VIEW_CHANNEL` are not captured, and `discord_list_channels` returns `hiddenChannelCount`, `coverageComplete`, and a warning when coverage is incomplete. Grant the bot `VIEW_CHANNEL` on the channels it must back up, and treat a snapshot with `complete: false` as a partial rollback point.

## Backup Schema v2

Snapshots declare `schemaVersion: 2`. Backups written by 0.2.0 always use v2; reads still accept v1 snapshots and upcast them by filling the new coverage and optional fields.

The v2 snapshot adds:

- `coverage.channels` as described above.
- Role `colors` with `primary`, `secondary`, and `tertiary` values.
- Channel `bitrate`, `userLimit`, and `rtcRegion` fields.

Threads are excluded from snapshots and from channel coverage. They live in the gateway channel cache but Discord cannot recreate them through the channel API, so a backup never claims to restore them and the snapshot reports how many were skipped.

Restore plans add a `planHash` and `NOT_RESTORED` warnings for captured sections that Discord does not let the server apply. See [Restore Planning And Apply](#restore-planning-and-apply).

## Atomic Backup Writes

Snapshot writes are atomic. The store writes to a temporary file in the backup directory, synchronizes it to disk, renames it into place with a retry for Windows rename behavior, and validates the parsed snapshot before returning a backup ID. A crash therefore cannot expose a partial file under a valid backup name.

Backup paths are contained:

- `BACKUP_DIR` must stay inside the project directory.
- Directory resolution rejects symlinked or junctioned components and verifies that the real path stays inside the project root, including reparse points on Windows.
- Containment is re-validated before every backup read and write, so a junction created inside the project after startup cannot redirect a snapshot outside the project.
- Backup reads reject symbolic links, oversized files, excessive JSON depth or container sizes, malformed resources, and paths not issued by the backup tools.

## Restore Planning And Apply

`discord_backup_restore_plan` compares a snapshot with the current guild and returns a plan with a `planHash` derived from the source backup, target guild, mapped operations, and warnings. `discord_backup_restore_apply` accepts an optional `expectedPlanHash`; a mismatch is rejected as drift before any Discord mutation.

Apply is conservative and truthful:

- It creates a pre-restore backup before the first Discord mutation and retains its ID in error responses.
- It stops on the first Discord operation error and reports applied, skipped, and failed operations so the operator can assess the partial state.
- It reports `NOT_RESTORED` warnings for captured sections that Discord cannot recreate or update.
- It skips permission overwrites for members that no longer exist and reports a warning instead of aborting the whole channel restore.
- It applies supported positions, parents, permission overwrites, role colors, and channel audio settings.
- It only deletes objects when the request explicitly opts in to deletes.
- Role and channel identity is matched by Discord ID first and by an unambiguous semantic match when cloning across guilds.

## Mutation Queue

Mutating tools run through a shared FIFO mutation queue so that two tool calls cannot interleave Discord writes. Restore apply holds an exclusive slot and rejects immediately when another mutation is running. Shutdown drains queued and in-flight mutations for up to 10 seconds; if a mutation is still in flight after that window, the server logs a structured shutdown warning instead of pretending the work completed.

## Restore Limits

Restore is best-effort. Discord does not allow full restoration of:

- Original IDs after delete/recreate
- Message history
- Audit-log history
- Exact invite codes
- Webhook tokens
- Managed integration-owned roles
- Every community, discovery, or boost-related setting

Backup files are treated as untrusted local input. New and legacy snapshots are recursively sanitized before use: invite codes and URLs, webhook tokens and URLs, authorization fields, and other token or secret fields are removed.
