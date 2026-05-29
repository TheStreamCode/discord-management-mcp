# Discord Management MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Discord management MCP with read/write tools, JSON backup snapshots, restore planning, and safe mutation guards.

**Architecture:** A stdio MCP server registers focused Discord tools. Shared services handle config loading, Discord client lifecycle, backup snapshot serialization, safety gates, and response formatting.

**Tech Stack:** Node 24, TypeScript ESM, `@modelcontextprotocol/sdk`, `discord.js`, `zod`, Vitest.

---

## File Structure

- `src/index.ts`: MCP entrypoint and tool registration.
- `src/config.ts`: safe config and `.env.local` parsing.
- `src/discordClient.ts`: Discord client lifecycle.
- `src/safety.ts`: confirmation and backup guard helpers.
- `src/responses.ts`: structured MCP response helpers.
- `src/backup/schema.ts`: snapshot types.
- `src/backup/store.ts`: JSON file storage.
- `src/backup/snapshot.ts`: Discord guild serialization.
- `src/backup/diff.ts`: restore diff and plan operations.
- `src/tools/backupTools.ts`: backup tools and conservative restore apply.
- `src/tools/*.ts`: grouped MCP tools.
- `src/__tests__/*.test.ts`: unit tests for config, safety, backup diff.

## Tasks

### Task 1: Core Project Infrastructure

- [x] Implement config parsing without printing secrets.
- [x] Implement response helpers.
- [x] Implement safety guards.
- [x] Add unit tests for `.env.local` parsing and mutation guard behavior.
- [x] Run `npm install` locally in the project, then `npm run test`.

### Task 2: Discord Client and Read-Only Tools

- [x] Implement client startup/shutdown.
- [x] Register read-only tools for guilds, channels, roles, members, AutoMod, events, webhooks, invites, emojis, stickers, application commands.
- [x] Ensure large lists support `limit` where applicable.
- [x] Run typecheck/build.

### Task 3: JSON Backup and Restore Planning

- [x] Implement canonical snapshot schema and backup store.
- [x] Implement `backup_create`, `backup_list`, `backup_read`.
- [x] Implement `backup_diff` and `backup_restore_plan`.
- [x] Add tests for backup store naming and diff behavior.

### Task 4: Mutating Discord Tools

- [x] Implement channel tools with confirmation and backup guards.
- [x] Implement role tools with hierarchy-aware errors.
- [x] Implement AutoMod and scheduled-event mutation tools.
- [x] Implement member moderation tools.
- [x] Run build and targeted tests.

### Task 5: Restore Apply and Final Verification

- [x] Implement conservative restore apply with ID-map reporting.
- [x] Add lossy-operation reporting.
- [x] Run `npm run build`, `npm run typecheck`, `npm run test`.
- [x] Produce final MCP usage instructions.
