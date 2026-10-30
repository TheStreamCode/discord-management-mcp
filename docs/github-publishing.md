# GitHub and npm Publishing

## Release Preconditions

Before creating a release:

1. Confirm the worktree contains only the intended release changes.
2. Confirm `.env.local`, `backups/`, `node_modules/`, `dist/`, coverage, logs, and package tarballs are not tracked.
3. Update the version in `package.json` and `package-lock.json`.
4. Add the matching section to `CHANGELOG.md`, update `CITATION.cff`, and bump the version in `server.json` so it matches `package.json`.
5. Run:

   ```bash
   npm ci
   npm run release:check -- vX.Y.Z
   npm run preflight
   npm run verify:mcp
   npm run pack:check
   npm audit --omit=dev --audit-level=high
   ```

6. Inspect the `npm run pack:check` manifest. It must contain the compiled `dist/` entrypoint and must not contain secrets, backups, source maps with private paths, or the repository hero image.
7. Merge the release change through the protected `main` branch.
8. Create a GitHub release whose tag exactly matches `vX.Y.Z`. Publishing the release triggers `.github/workflows/publish.yml`.

## npm Publication

The package name is `discord-management-mcp` and publication is configured for the public npm registry.
Version `0.1.0` was published on 2026-08-01 with npm provenance, bootstrapped by a granular automation
token stored as the `NPM_TOKEN` repository secret. Starting with `0.2.0`, publication uses npm Trusted
Publishing (OIDC) and the long-lived token is no longer used by the workflow.

The workflow grants `id-token: write`, runs on a GitHub-hosted runner, verifies source and release
metadata, and publishes with npm provenance. It also runs in the `npm` environment, verifies that the
release commit is an ancestor of `main`, re-runs `pack:check`, and blocks on the runtime dependency
audit before publishing. A `workflow_dispatch` trigger accepts an existing release tag so a failed
publication can be retried without recreating the release.

### Trusted Publishing

Trusted Publishing is configured on npmjs.com for:

- provider: GitHub Actions
- organization: `TheStreamCode`
- repository: `discord-management-mcp`
- workflow: `publish.yml`
- environment: `npm`
- allowed actions: `npm publish`, `npm stage publish`

The connection stays in `Pending validation` until the first successful OIDC publication. After that
first publish, delete the unused `NPM_TOKEN` repository secret and keep the traditional-token option
restricted in the package settings.

A release is published with `npm publish --provenance`; no npm token exists in the workflow, so there
is nothing to rotate and a stolen repository secret cannot publish the package.

## GitHub Repository Settings

Keep the following settings enabled:

- Issues, secret scanning, and push protection.
- Dependency vulnerability alerts and Dependabot security updates.
- Squash merge and automatic branch deletion.
- Branch protection on `main` with the `build-and-test` check, linear history, conversation resolution, and pull-request review.
- Auto-merge only for dependency updates that pass all required checks.

Recommended repository metadata:

- Description: `Safe-by-default Discord management MCP server with JSON backups, restore planning, and guarded mutations.`
- Website: `https://www.npmjs.com/package/discord-management-mcp` until a dedicated project page exists
- Topics: `mcp`, `mcp-server`, `model-context-protocol`, `discord`, `discord-js`, `discord-bot`, `discord-management`, `typescript`, `nodejs`, `ai-agents`, `backup`, `rollback`
- Social preview: use `assets/github-social-preview.png` from the matching release source tree

Do not publish bot tokens, webhook URLs, invite secrets, backup files, or screenshots that expose private guild details.

## Maintainer

Author and maintainer: [Michael Gasperini](https://mikesoft.it).
