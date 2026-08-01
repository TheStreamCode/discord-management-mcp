## Summary

<!-- What does this PR do and why? Link the related issue below. -->

Fixes #

## Changes

-

## Safety verification

- [ ] Mutation operations require explicit confirmation
- [ ] Backup is created before destructive operations
- [ ] `backupId` is validated and logged for rollback
- [ ] No new outbound network calls beyond Discord API
- [ ] Zod validation added for any new input schemas

## Testing

- [ ] `npm run preflight` passes
- [ ] `npm run pack:check` passes when package or release files changed
- [ ] Added or updated regression tests for changed behavior
- [ ] No live Discord mutation was required, or the authorized test guild and result are documented below
- [ ] Backup/restore changes were exercised end-to-end with mocks or an authorized test guild

## Release impact

- [ ] `CHANGELOG.md` updated when user-visible behavior changed
- [ ] Package version remains unchanged, or release metadata is consistent

## Notes

-
