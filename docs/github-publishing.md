# GitHub and npm Publishing

## Release Preconditions

Before creating a release:

1. Confirm the worktree contains only the intended release changes.
2. Confirm `.env.local`, `backups/`, `node_modules/`, `dist/`, coverage, logs, and package tarballs are not tracked.
3. Update the version in `package.json` and `package-lock.json`.
4. Add the matching section to `CHANGELOG.md` and update `CITATION.cff`.
5. Run:

   ```bash
   npm ci
   npm run release:check -- vX.Y.Z
   npm run preflight
   npm run pack:check
   npm audit --omit=dev
   ```

6. Inspect the `npm run pack:check` manifest. It must contain the compiled `dist/` entrypoint and must not contain secrets, backups, source maps with private paths, or the repository hero image.
7. Merge the release change through the protected `main` branch.
8. Create a GitHub release whose tag exactly matches `vX.Y.Z`. Publishing the release triggers `.github/workflows/publish.yml`.

## npm Publication

The package name is `discord-management-mcp` and publication is configured for the public npm registry.
Version `0.1.0` was published on 2026-08-01 with npm provenance, bootstrapped by a granular automation
token stored as the `NPM_TOKEN` repository secret.

The workflow grants `id-token: write`, runs on a GitHub-hosted runner, verifies source and release
metadata, and publishes with npm provenance.

### Pending: migrate to Trusted Publishing

Now that the package exists on npm, the token bootstrap should be retired. This is a manual
maintainer task on npmjs.com; it cannot be scripted from the repository.

1. Configure npm Trusted Publishing for:
   - provider: GitHub Actions
   - organization: `TheStreamCode`
   - repository: `discord-management-mcp`
   - workflow: `publish.yml`
   - allowed action: `npm publish`
2. Remove the `NODE_AUTH_TOKEN` env block from `.github/workflows/publish.yml`.
3. Delete the `NPM_TOKEN` GitHub secret.
4. Restrict traditional token-based publication in the npm package settings.

Do not remove the secret before step 1 is complete: the publish workflow would lose its only
credential and the next release would fail.

## GitHub Repository Settings

Keep the following settings enabled:

- Issues, secret scanning, and push protection.
- Dependency vulnerability alerts and Dependabot security updates.
- Squash merge and automatic branch deletion.
- Branch protection on `main` with the `build-and-test` check, linear history, conversation resolution, and pull-request review.
- Auto-merge only for dependency updates that pass all required checks.

Recommended repository metadata:

- Description: `Safe-by-default Discord management MCP server with JSON backups, restore planning, and guarded mutations.`
- Website: `https://mikesoft.it`
- Topics: `mcp`, `discord`, `discord-bot`, `discord-management`, `model-context-protocol`, `backup`, `rollback`

Do not publish bot tokens, webhook URLs, invite secrets, backup files, or screenshots that expose private guild details.

## Maintainer

Author and maintainer: [Michael Gasperini](https://mikesoft.it).
