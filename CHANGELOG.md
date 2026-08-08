# Changelog

All notable changes to this project are documented in this file.

## Unreleased

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
