const DISCORD_TOKEN_PATTERN = /\b(?:mfa\.[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,})\b/g;
const DISCORD_WEBHOOK_PATTERN = /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/\d+\/[^\s/]+/gi;
const DISCORD_INVITE_PATTERN = /https:\/\/(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/[A-Za-z0-9-]+/gi;
const AUTHORIZATION_PATTERN = /\bAuthorization\s*:\s*[^\r\n]+/gi;
const MAX_ERROR_LENGTH = 1_024;

export function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
  const projectRoot = process.cwd();
  const redacted = raw
    .replace(DISCORD_WEBHOOK_PATTERN, "[redacted Discord webhook]")
    .replace(DISCORD_INVITE_PATTERN, "[redacted Discord invite]")
    .replace(DISCORD_TOKEN_PATTERN, "[redacted Discord token]")
    .replace(AUTHORIZATION_PATTERN, "Authorization: [redacted]")
    .replaceAll(projectRoot, "[project]")
    .replace(/\.env\.local/gi, "[redacted env file]");

  return redacted.length <= MAX_ERROR_LENGTH
    ? redacted
    : `${redacted.slice(0, MAX_ERROR_LENGTH - 1)}…`;
}
