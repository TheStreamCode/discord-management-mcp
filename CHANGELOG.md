# Changelog

All notable changes to this project are documented in this file.

## Unreleased

### Added

- A `Publish to MCP Registry` workflow that publishes `server.json` with GitHub OIDC, pins
  `mcp-publisher` and verifies its release checksum. The official registry entry for
  `io.github.TheStreamCode/discord-management-mcp` is now maintained from CI without stored
  credentials.

## 0.2.0 - 2026-10-30

### Added

- Seven new tools: `discord_list_audit_log`, `discord_list_role_member_counts`, `discord_list_bans`, `discord_search_members`, `discord_set_incident_actions`, `discord_bulk_ban_members`, and `discord_set_voice_channel_status`, bringing the server to 54 tools.
- Backup schema v2 with channel coverage metadata (`coverage.channels` containing `fetched`, `cacheSize`, `hiddenKeys`, and `complete`), role colors, channel `bitrate`, `userLimit`, and `rtcRegion` fields, and structured warnings.
- Restore plans include a `planHash`. `discord_backup_restore_apply` accepts `expectedPlanHash` and rejects a plan that no longer matches the current guild state.
- A FIFO mutation queue serializes mutating tool calls, and restore apply holds an exclusive slot.
- Functional structured logging: `LOG_LEVEL` accepts `error`, `warn`, `info`, and `debug`, and writes JSON lines to stderr only.
- MCP registry metadata: `package.json` declares `mcpName` and the repository ships `server.json`, both identifying `io.github.TheStreamCode/discord-management-mcp`.
- Release and CI hardening: publication uses npm Trusted Publishing (OIDC) with no long-lived token, the publish workflow gates on audit, `pack:check`, main ancestry and the `npm` environment, a manual dispatch trigger can retry a failed publication, the `npm run verify:mcp` protocol smoke test runs on Linux and Windows, the Windows job builds and verifies the npm package, and a weekly dependency audit workflow was added.

### Changed

- Restore apply reports `NOT_RESTORED` warnings for captured sections that Discord cannot apply, and retains the pre-restore backup ID on every error path.
- The backup guard now also covers `discord_set_channel_permissions` and `discord_update_guild_settings`. `discord_set_incident_actions` stays available without a backup for emergency response.
- Channel listings and backups record hidden or obfuscated channels in the new coverage metadata instead of treating an incomplete snapshot as complete.
- A new `docs/setup.md` walks through creating the Discord application and bot, inviting it with the right permissions and role hierarchy, copying the server ID, registering every supported MCP client, verifying the connection, running the first backup and restore, and the permissions required per tool family.
- README, configuration, tool, safety, and design documentation were rewritten for 0.2.0, including supported MCP clients, the 54-tool catalog, the backup guard matrix, and the updated privileged-intent policy.
- The documentation workflow now lints `docs/*.md` in addition to the top-level documents.
- The `discord-api-types` override is now `^0.38.57`, so the server builds against current Discord API types.

### Fixed

- `LOG_LEVEL` now controls real logging. It was previously parsed as reserved metadata with no effect.
- Backup writes are atomic: snapshots are written to a temporary file, synchronized, and renamed, so a crash cannot leave a valid-looking partial backup.
- Backup directory resolution rejects symlinked or junctioned components and verifies the real path stays inside the project root; containment is re-validated before every read and write, so a junction created after startup cannot redirect a snapshot, and backup reads reject reparse points.
- The Discord client resets and reconnects after a non-recoverable disconnect, attaches persistent error handlers, and shutdown drains in-flight mutations before exiting.
- Threads found in the gateway channel cache are excluded from channel snapshots and coverage. Discord cannot recreate threads through the channel API, so backups no longer list them as restorable channels and report how many were skipped.
- Channel mutations now check the discord.js `manageable` getter instead of the `editable` getter, which only exists on messages, roles, and threads in discord.js 14. Channel update, delete, permission overwrite, and voice status previously failed against real Discord even though mocked tests passed.
- Role create, update, and restore pass gradient colors through the supported `colors` option instead of the deprecated single `color` field.
- `discord_list_channel_messages` rejects conflicting pagination combinations instead of sending an ambiguous request.

### Security

- Atomic backup writes with restrictive file permissions reduce the risk of truncated or easily readable snapshots.
- The backup guard matrix stays enforced: every mutating Discord tool requires `confirm: true` and a non-empty reason, and the listed high-impact operations require a same-guild backup or an explicit `allowWithoutBackup: true` acknowledgement.
- Restore apply verifies `expectedPlanHash` when provided, so a plan that drifted from the current guild state cannot be applied silently.
- Channel coverage warnings prevent an incomplete backup from being mistaken for a complete rollback point.

## 0.1.2 - 2026-08-08

### Security

- Removed invite codes and URLs from tool responses and snapshots, recursively sanitize legacy backup data, redact secrets from surfaced errors, keep full backup payloads local, and reject symbolic-link, oversized, deeply nested, or structurally invalid backup input.
- Updated audited transitive dependencies in the lockfile and grouped Dependabot security updates to prevent advisory PR deadlocks.

### Fixed

- All 47 MCP tools now advertise a root-object output schema with a consistent `ok` field; backup schemas are no longer silently omitted by the protocol SDK.
- Restore apply now stops on the first failed mutation while retaining the pre-restore backup ID and reporting applied, skipped, and failed operations truthfully.
- Mutation inputs now use bounded Discord IDs, reasons, arrays, and payloads; invalid enum values, duplicate reorder/message IDs, ambiguous bulk-delete requests, and no-op updates fail before contacting Discord.

### Changed

- Reworked the README around a package-first quick start, an explicit safety architecture, a sanitized operator workflow, capability discovery, and clearer support paths.
- Added optimized wide project artwork and a dedicated GitHub social-preview asset while preserving the previous hero image for historical continuity.

## 0.1.1 - 2026-08-02

### Changed

- The published npm package no longer ships `docs/implementation-plan.md` (a completed internal build
  checklist) or `docs/github-publishing.md` (a maintainer-only release runbook). Both remain in the
  repository; the `files` field now lists the four consumer-facing documents explicitly.
- `docs/github-publishing.md` now records that the first npm publication is complete and describes the
  pending migration from the bootstrap `NPM_TOKEN` secret to npm Trusted Publishing.

### Fixed

- Backup tools now declare both success and failure output shapes, preventing MCP clients from replacing
  structured application errors with an output-schema validation failure.
- `SECURITY.md` no longer states that tagged releases have not been introduced; supported versions now
  reference the published `0.1.x` line.

### Documentation

- Added verified npm version, supported-Node, and license badges to the README.
- Reorganized the README setup section so the published npm package is the primary install path, with
  installation from source kept as a separate option.
- `CITATION.cff` now declares `repository-code` and `date-released`.

## 0.1.0 - 2026-08-01

### Added

- Initial release: safe-by-default Discord management MCP server with JSON guild backups, restore planning, and guarded mutations.
- Snapshots strip secret fields (tokens, secrets, authorization) so backup files never contain bot or webhook credentials.
- Destructive operations are gated and require explicit intent, with restore planning to preview changes before applying them.
- Repository-specific `AGENTS.md`, TypeScript linting, Windows CI coverage, npm package verification, and an npm publication workflow with provenance.
- Regression tests for restore identity, role ordering, cross-guild permission mapping, required snapshot sections, and malformed backup data.

### Changed

- Restore matching now prefers immutable Discord IDs and uses unambiguous semantic matching across guilds, avoiding duplicate resources after renames or reorders.
- Role and channel restore now applies supported positions, parents, and safely mapped permission overwrites.
- Runtime and development dependencies were refreshed, and GitHub Actions are pinned to immutable commits.

### Security

- Backup reads now validate the complete snapshot structure before restore planning or application.
- Core role/channel capture fails closed, backup paths use restrictive modes where supported, and fixable dependency advisories were removed.
