# Security Policy

## Supported Versions

Security fixes target the latest `main` branch until tagged releases are introduced.

## Reporting A Vulnerability

Do not open a public issue for secrets, bypasses, or exploitable behavior.

Report privately to [Michael Gasperini](https://mikesoft.it) or the repository maintainer. Include:

- Impacted version or commit
- Reproduction steps
- Expected and actual behavior
- Whether a Discord token, webhook token, backup, or guild structure was exposed

## Operational Security

- Use a dedicated Discord bot token.
- Give the bot only the permissions required for your workflow.
- Keep `.env.local` local.
- Keep backup JSON files private.
- Rotate the bot token immediately if it is exposed.
- Do not use user tokens or selfbots.

## Sensitive Data

Backups can contain server structure, permission overwrites, invite metadata, and other operational details. They are intentionally ignored by Git and should not be uploaded to public repositories.
