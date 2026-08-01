# Changelog

All notable changes to this project are documented in this file.

## Unreleased

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
