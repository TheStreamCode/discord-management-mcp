# Contributing

Thanks for improving Discord Management MCP.

Maintainer: [Michael Gasperini](https://mikesoft.it) / [TheStreamCode](https://github.com/TheStreamCode).

## Local Development

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run verify:mcp
npm run pack:check
```

`npm run verify:mcp` starts the built server over stdio with a placeholder token and checks the advertised MCP surface; it never calls Discord and needs no real credentials.

Use Node.js `>=24`. Do not commit `node_modules/`, `dist/`, `.env.local`, backups, or logs.

## Design Principles

- Prefer safe-by-default behavior over convenience.
- Keep read-only tools separate from mutating tools.
- Require `confirm: true` and a non-empty `reason` for every mutation.
- Require a guild-matched backup before destructive operations unless the caller explicitly opts out.
- Never expose Discord bot tokens, webhook tokens, or `.env.local` contents.
- Return structured content that is easy for MCP clients to inspect.

## Pull Request Checklist

- New tools have clear names and descriptions.
- Inputs use Zod validation with useful bounds.
- Mutating tools use confirmation guards and accurate MCP annotations.
- Mutating tools run through the shared mutation queue, and restore apply holds the exclusive slot.
- Delete and other high-impact destructive tools use backup guards, and the guard matrix in `docs/tools.md` stays in sync.
- Backup-affecting changes keep snapshots atomic and record channel coverage.
- Error responses include actionable next steps.
- Tests cover safety-critical behavior.
- `npm run preflight`, `npm run verify:mcp`, and `npm run pack:check` pass.

All changes should be submitted through pull requests. Direct pushes to the protected default branch are reserved for the maintainer bypass path.
