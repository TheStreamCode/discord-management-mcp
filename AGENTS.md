# AGENTS.md

## Scope

These instructions apply to the entire repository.

Discord Management MCP is a Node.js 24, TypeScript ESM, stdio-only MCP server. It manages real Discord guilds, so correctness and explicit operator intent take priority over convenience.

## Repository Map

- `src/index.ts`: process entrypoint and tool registration.
- `src/config.ts`: environment and `.env.local` parsing.
- `src/discordClient.ts`: Discord client lifecycle.
- `src/logger.ts`: structured JSON logging on stderr.
- `src/mutationQueue.ts`: FIFO serialization for mutating tool calls.
- `src/safety.ts`: deterministic confirmation and backup guards.
- `src/backup/`: snapshot schema, validation, storage, diff, and restore primitives.
- `src/tools/`: MCP tool definitions grouped by domain.
- `src/__tests__/`: unit and regression tests. Tests must not contact Discord.
- `docs/`: design, configuration, safety, tool, and release documentation.
- `examples/`: explicitly confirmed operator examples; these may mutate a live guild.
- `.github/`: contribution forms, ownership, CI, and release automation.

## Setup and Verification

Use the repository-local toolchain; do not install or change global Node.js tooling.

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run verify:mcp
npm run preflight
npm run pack:check
npm audit --omit=dev --audit-level=high
```

Run focused tests while iterating, then run `npm run preflight` before handing off code changes. Run `npm run verify:mcp` after a build; it starts the built server over stdio with a placeholder token, validates the advertised MCP surface, and must never call Discord. Run `npm run pack:check` whenever package metadata, build output, documentation included in the package, or release automation changes.

Markdown changes must pass the Docs workflow. Run the same linter locally with `npx --yes markdownlint-cli2@0.24.0 "README.md" "CONTRIBUTING.md" "SECURITY.md" "SUPPORT.md" "CODE_OF_CONDUCT.md" "AGENTS.md" "docs/*.md"`.

## Safety Invariants

- Never print, return, commit, or place in fixtures a real bot token, webhook token, invite secret, authorization header, `.env.local`, or backup payload.
- Never run an example or perform a live Discord mutation unless the user explicitly asks for that live action and identifies the intended guild.
- Every mutating MCP tool must require `confirm: true` and a non-empty audit reason.
- The backup guard matrix in `docs/tools.md` is normative. Tools marked as backup-guarded must retain their `backupId` requirement or explicit `allowWithoutBackup: true` acknowledgement, and the docs, inputs, and tests must stay in sync. `discord_set_incident_actions` remains ungated for emergency use, and `discord_backup_restore_apply` relies on its own pre-restore backup.
- Guild-targeted destructive actions must verify that the backup belongs to the target guild.
- Core backup sections such as roles and channels must fail closed when they cannot be captured. Optional sections may emit structured warnings.
- Every mutating tool handler must run through the shared FIFO mutation queue (`withMutationQueue`), and restore apply must hold the exclusive slot (`withExclusiveMutation`). Never call a Discord mutation outside the queue.
- Backup writes must be atomic: a temporary file in the backup directory, a filesystem sync, and a rename with retry before the backup ID is returned. A partial file must never be exposed as a valid backup.
- Backup containment must be re-validated before every read and write (`assertBackupDirInsideProject`), not only at startup, so a junction created inside the project after startup cannot redirect a snapshot.
- Snapshots must record `coverage.channels` (`fetched`, `cacheSize`, `hiddenKeys`, `complete`) and must never claim `complete: true` when the channel cache is empty or hidden or obfuscated channels were observed. Hidden channels require a warning, not silent omission.
- Restore plans must include a `planHash`, and `discord_backup_restore_apply` must reject an `expectedPlanHash` mismatch before the first Discord mutation. Restore results must retain the pre-restore backup ID and report `NOT_RESTORED` warnings truthfully.
- Logs are JSON lines on stderr under `LOG_LEVEL`. Stdout is reserved for MCP protocol traffic and must never carry log output.
- Keep message-content and guild-member privileged intents opt-in.
- Keep webhook tokens out of tool output and recursively remove secret fields from snapshots.
- Cross-guild restore must remain explicit, conservative, and safe when IDs or permission targets cannot be mapped.
- Restore apply must create a pre-restore backup before the first Discord mutation and must report skipped or lossy operations truthfully.
- MCP annotations must describe actual behavior: read-only tools are read-only, additive tools are non-destructive, and updates/deletes are marked destructive where appropriate.

## Code Conventions

- Use strict TypeScript and ESM imports with `.js` extensions for local modules.
- Prefer focused modules and typed helpers over broad casts. When an SDK boundary requires a cast, keep it narrow and validate the input first.
- Define bounded Zod input schemas for every tool. Use Discord API limits where known.
- Return both readable MCP text and structured content. Error responses must be actionable and must not expose secrets.
- Treat backup JSON as untrusted local input: validate it before planning or applying changes.
- Preserve stable identity across renames and reorders. Do not derive matching solely from mutable names or positions.
- Add regression tests for safety guards, snapshot validation, identity matching, restore mapping, and error paths.
- Keep comments focused on non-obvious safety or protocol decisions.

## Generated and Sensitive Files

- Do not edit or commit `dist/`; it is generated by `npm run build` and included at npm pack time.
- Do not commit `.env*` except `.env.example`, `backups/`, `coverage/`, logs, `node_modules/`, or generated package tarballs.
- Do not inspect or echo `.env.local` during routine review. Verify only that Git ignores it.
- Preserve unrelated working-tree changes and never rewrite user work to clean the repository.

## GitHub and Releases

- Use focused commits and pull requests. Prefer Conventional Commit subjects such as `fix:`, `feat:`, `docs:`, `test:`, and `chore:`.
- Do not commit, push, create tags/releases, change repository settings, or publish to npm unless the user explicitly authorizes that external action.
- Keep the required `build-and-test` status context stable unless branch protection is updated in the same authorized operation.
- Pin third-party GitHub Actions to full commit SHAs and retain a version comment.
- For a release, update `package.json` and `package-lock.json`, `CHANGELOG.md`, and `CITATION.cff`; then run `npm run release:check -- vX.Y.Z`, `npm run preflight`, `npm run verify:mcp`, and `npm run pack:check`. `release:check` fails unless the release metadata files agree on the version, including `server.json` and the `mcpName` value.
- Never publish from a workstation. Publication happens only when a GitHub Release whose tag is `vX.Y.Z` is created; that event triggers `.github/workflows/publish.yml`, which republishes with provenance.
- The package is live on npm as `discord-management-mcp` (first publication 2026-08-01). Trusted Publishing is not configured yet, so `publish.yml` still depends on the bootstrap `NPM_TOKEN` secret. Do not delete that secret or its `NODE_AUTH_TOKEN` env block until Trusted Publishing is configured on npmjs.com; see `docs/github-publishing.md`. The publish job also requires the `npm` environment, checks that the release commit is an ancestor of `main`, and runs the audit and `pack:check` gates before publishing.
- `.github/workflows/audit.yml` runs a weekly runtime dependency audit with `npm audit --omit=dev --audit-level=high`. It is an early-warning job, not a required status check.
- The `files` field lists consumer-facing documentation explicitly, and now includes `SUPPORT.md` and `server.json` alongside the five consumer docs (`setup.md` was added for the bot and client walkthrough). `docs/implementation-plan.md` and `docs/github-publishing.md` are repository-only and must stay out of the npm tarball. Re-run `npm run pack:check` after touching `files` or adding a document.
- `allowScripts` in `package.json` is a supported npm install-script allowlist, not dead metadata. Keep it in sync with the resolved `esbuild` version instead of deleting it.
- `@types/node` is `^24.13.3`, on the 24.x line that matches the `engines.node` runtime (Node 24), and TypeScript is held at 6.x because the 7.x upgrade fails CI. Do not bump either just because `npm outdated` reports a newer major.
