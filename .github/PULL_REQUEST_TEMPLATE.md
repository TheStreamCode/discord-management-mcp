## Summary

<!-- What problem does this change solve? Link the related issue below. -->

Fixes #

## Change

<!-- What did you change, and why this approach? -->

## Verification

- [ ] `npm run preflight` passes
- [ ] `npm run pack:check` passes when package or release files changed
- [ ] Added or updated regression tests for changed behavior
- [ ] No live Discord mutation was required, or the authorized test guild and result are documented below
- [ ] Backup or restore changes were exercised end to end with mocks or an authorized test guild
- [ ] Required CI checks pass (`build-and-test` and `windows-test`)

## Checklist

- [ ] Focused change, one problem per pull request
- [ ] Documentation and `CHANGELOG.md` updated when behavior changed
- [ ] Package version remains unchanged, or release metadata is consistent

## Safety and release notes

- [ ] Mutation operations require explicit confirmation and a non-empty audit reason
- [ ] A backup is created before destructive operations, or the opt-out is explicit
- [ ] `backupId` is validated and belongs to the target guild
- [ ] No new outbound network calls beyond the Discord API
- [ ] Zod validation added for any new input schema
- [ ] No bot tokens, webhook tokens, invite codes, or backup payloads in code, tests, or logs
