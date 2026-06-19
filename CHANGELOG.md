# Changelog

All notable changes to this project are documented in this file.

## 0.1.0

- Initial release: safe-by-default Discord management MCP server with JSON guild backups, restore planning, and guarded mutations.
- Snapshots strip secret fields (tokens, secrets, authorization) so backup files never contain bot or webhook credentials.
- Destructive operations are gated and require explicit intent, with restore planning to preview changes before applying them.
