# GitHub Publishing Checklist

Before publishing this repository:

1. Confirm `.env.local` is not committed.
2. Confirm `backups/` is not committed.
3. Confirm `node_modules/` and `dist/` are not committed.
4. Run:

   ```bash
   npm run typecheck
   npm test
   npm run build
   npm audit --omit=dev
   ```

5. Review `README.md`, `SECURITY.md`, and `CONTRIBUTING.md`.
6. Add repository metadata on GitHub:
   - Description: `Safe-by-default Discord management MCP server with JSON backups and rollback planning.`
   - Topics: `mcp`, `discord`, `discord-bot`, `model-context-protocol`, `backup`, `rollback`
   - Website: `https://mikesoft.it`
7. Create the first tag after verification:

   ```bash
   git tag v0.1.0
   ```

Do not publish bot tokens, webhook URLs, backup files, or screenshots that expose private guild details.

## Maintainer

Author and maintainer: [Michael Gasperini](https://mikesoft.it).
