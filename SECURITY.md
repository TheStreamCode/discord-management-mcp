# Security Policy

## Supported Versions

Security fixes target the latest published `0.2.x` release and the current `main` branch.
Older versions are not patched; upgrade to the newest release before reporting an issue.

## Reporting A Vulnerability

Do not open a public issue for secrets, bypasses, or exploitable behavior.

Report privately through [GitHub private vulnerability reporting](https://github.com/TheStreamCode/discord-management-mcp/security/advisories/new). If GitHub reporting is unavailable, contact [Michael Gasperini](https://mikesoft.it). Include:

- Impacted version or commit
- Reproduction steps
- Expected and actual behavior
- Whether a Discord token, webhook token, backup, or guild structure was exposed

## Scope

In scope:

- defects in this repository's code, build scripts, or release artifacts;
- credential or secret exposure caused by this project;
- a mutation guard or backup guard that can be bypassed by a client.

Out of scope:

- vulnerabilities in Discord, Discord.js, or another third-party product, which must be reported
  upstream;
- misconfiguration of an operator's environment or MCP client;
- social engineering, spam, or denial-of-service against third-party services.

## Response Expectations

Reports are acknowledged within 7 days and receive a status update within 30 days. A valid report
is fixed privately and disclosed in the release notes once a patched version is available. Credit
is given in the advisory unless you ask otherwise.

## Operational Security

- Use a dedicated Discord bot token.
- Give the bot only the permissions required for your workflow.
- Keep `.env.local` local.
- Keep backup JSON files private.
- Rotate the bot token immediately if it is exposed.
- Do not use user tokens or selfbots.

## Sensitive Data

Backups can contain server structure, permission overwrites, invite metadata, and other operational details. They are intentionally ignored by Git and should not be uploaded to public repositories.
