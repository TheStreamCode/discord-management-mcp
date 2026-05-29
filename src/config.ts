import { existsSync, readFileSync } from "node:fs";
import path, { join } from "node:path";

export type AppConfig = {
  discordToken: string;
  backupDir: string;
  logLevel: string;
  enableMessageContent: boolean;
  enableGuildMembers: boolean;
};

export type ServerConfig = AppConfig;

type EnvKey =
  | "DISCORD_TOKEN"
  | "BACKUP_DIR"
  | "LOG_LEVEL"
  | "ENABLE_MESSAGE_CONTENT"
  | "ENABLE_GUILD_MEMBERS";

type EnvFileValues = Partial<Record<EnvKey, string>>;

const ENV_KEYS = [
  "DISCORD_TOKEN",
  "BACKUP_DIR",
  "LOG_LEVEL",
  "ENABLE_MESSAGE_CONTENT",
  "ENABLE_GUILD_MEMBERS",
] as const;

export function loadConfig(projectRoot = process.cwd()): AppConfig {
  const envFileValues = loadEnvLocal(projectRoot);
  const rawDiscordToken = process.env.DISCORD_TOKEN ?? envFileValues.DISCORD_TOKEN;
  const backupDir = process.env.BACKUP_DIR ?? envFileValues.BACKUP_DIR ?? "backups";

  if (!rawDiscordToken) {
    throw new Error("DISCORD_TOKEN is required. Set it in process.env or .env.local.");
  }

  const discordToken = normalizeDiscordToken(rawDiscordToken);
  validateDiscordToken(discordToken);

  return {
    discordToken,
    backupDir: resolveBackupDir(projectRoot, backupDir),
    logLevel: process.env.LOG_LEVEL ?? envFileValues.LOG_LEVEL ?? "info",
    enableMessageContent: parseBooleanEnv(
      process.env.ENABLE_MESSAGE_CONTENT ?? envFileValues.ENABLE_MESSAGE_CONTENT,
      false,
      "ENABLE_MESSAGE_CONTENT",
    ),
    enableGuildMembers: parseBooleanEnv(
      process.env.ENABLE_GUILD_MEMBERS ?? envFileValues.ENABLE_GUILD_MEMBERS,
      false,
      "ENABLE_GUILD_MEMBERS",
    ),
  };
}

export function resolveBackupDir(projectRoot: string, backupDir: string): string {
  if (!backupDir.trim()) {
    throw new Error("BACKUP_DIR cannot be empty.");
  }

  if (path.isAbsolute(backupDir)) {
    throw new Error("BACKUP_DIR must be relative to the project directory.");
  }

  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, backupDir);
  const relative = path.relative(root, resolved);

  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("BACKUP_DIR must stay inside the project directory.");
  }

  return resolved;
}

function loadEnvLocal(projectRoot: string): EnvFileValues {
  const envPath = join(projectRoot, ".env.local");

  if (!existsSync(envPath)) {
    return {};
  }

  return parseEnvFile(readFileSync(envPath, "utf8"));
}

export function parseEnvFile(contents: string): EnvFileValues {
  const values: EnvFileValues = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const parsed = parseEnvLine(rawLine);

    if (parsed) {
      values[parsed.key] = parsed.value;
    }
  }

  return values;
}

function parseEnvLine(line: string): { key: EnvKey; value: string } | null {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  for (const key of ENV_KEYS) {
    const dotenvMatch = trimmed.match(new RegExp(`^${key}\\s*=\\s*(.*)$`));
    const powershellMatch = trimmed.match(new RegExp(`^\\$env:${key}\\s*=\\s*(.*)$`, "i"));
    const value = dotenvMatch?.[1] ?? powershellMatch?.[1];

    if (value !== undefined) {
      return { key, value: normalizeEnvValue(value) };
    }
  }

  return null;
}

function normalizeEnvValue(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];

  if ((quote === `"` || quote === `'`) && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function normalizeDiscordToken(value: string): string {
  const trimmed = value.trim();

  if (trimmed.toLowerCase().startsWith("bot ")) {
    return trimmed.slice(4).trim();
  }

  return trimmed;
}

function validateDiscordToken(token: string): void {
  if (!token) {
    throw new Error("DISCORD_TOKEN is required. Set it in process.env or .env.local.");
  }

  if (/^[a-f0-9]{64}$/i.test(token)) {
    throw new Error(
      "DISCORD_TOKEN looks like a Discord Application Public Key. Use the Bot Token from Developer Portal > Bot > Reset Token.",
    );
  }
}

function parseBooleanEnv(value: string | undefined, fallback: boolean, key: string): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`${key} must be a boolean value: true/false, yes/no, on/off, or 1/0.`);
}
