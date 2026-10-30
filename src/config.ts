import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path, { join } from "node:path";
import { isLogLevel, LOG_LEVELS, type LogLevel } from "./logger.js";

export type AppConfig = {
  discordToken: string;
  backupDir: string;
  projectRoot: string;
  logLevel: LogLevel;
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
    projectRoot: path.resolve(projectRoot),
    logLevel: parseLogLevel(process.env.LOG_LEVEL ?? envFileValues.LOG_LEVEL),
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

/**
 * Resolves BACKUP_DIR against the project root and proves it cannot escape it.
 * Lexical checks are not enough: a junction or symlink inside the project can
 * point anywhere, so every existing component is checked and the real path of
 * the nearest existing ancestor is compared with the real project root.
 */
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
  const escapesRoot =
    relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);

  if (relative === "" || escapesRoot) {
    throw new Error("BACKUP_DIR must stay inside the project directory.");
  }

  const existingAncestor = nearestExistingAncestor(resolved);
  assertNoSymlinkComponents(root, existingAncestor);

  const realRoot = realpathSync.native(root);
  const realAncestor = realpathSync.native(existingAncestor);
  const realResolved = path.resolve(realAncestor, path.relative(existingAncestor, resolved));

  if (!isPathInside(realRoot, realResolved)) {
    throw new Error("BACKUP_DIR must stay inside the project directory.");
  }

  return resolved;
}

/**
 * Re-validates containment immediately before a backup read or write.
 *
 * `resolveBackupDir` runs once at startup. A junction created inside the
 * project after startup would otherwise survive that check (the final path
 * component can still be a real directory reached through the new junction),
 * so every store access re-checks the existing components and the real path.
 */
export function assertBackupDirInsideProject(
  projectRoot: string | undefined,
  backupDir: string,
): void {
  if (!projectRoot) {
    return;
  }

  const root = path.resolve(projectRoot);
  const resolved = path.resolve(backupDir);
  const existingAncestor = nearestExistingAncestor(resolved);
  assertNoSymlinkComponents(root, existingAncestor);

  const realRoot = realpathSync.native(root);
  const realAncestor = realpathSync.native(existingAncestor);
  const realResolved = path.resolve(realAncestor, path.relative(existingAncestor, resolved));

  if (!isPathInside(realRoot, realResolved)) {
    throw new Error("BACKUP_DIR must stay inside the project directory.");
  }
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
  const trimmed = stripInlineComment(value).trim();
  const quote = trimmed[0];

  if ((quote === `"` || quote === `'`) && trimmed.length >= 2 && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

/**
 * Removes a dotenv-style inline comment: a `#` preceded by whitespace and not
 * inside quotes. `TOKEN=abc#def` keeps the hash because dotenv treats it as
 * part of an unquoted value.
 */
function stripInlineComment(value: string): string {
  let quote: `"` | `'` | undefined;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (quote) {
      if (character === "\\" && quote === `"`) {
        index += 1;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }

    if (character === `"` || character === `'`) {
      quote = character;
      continue;
    }

    if (character === "#" && (index === 0 || /\s/.test(value[index - 1]))) {
      return value.slice(0, index);
    }
  }

  return value;
}

function parseLogLevel(value: string | undefined): LogLevel {
  const normalized = (value ?? "info").trim().toLowerCase();

  if (!isLogLevel(normalized)) {
    throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}.`);
  }

  return normalized;
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

function nearestExistingAncestor(target: string): string {
  let current = target;

  while (!lstatSync(current, { throwIfNoEntry: false })) {
    const parent = path.dirname(current);
    if (parent === current) {
      return current;
    }
    current = parent;
  }

  return current;
}

function assertNoSymlinkComponents(root: string, target: string): void {
  const relative = path.relative(root, target);

  if (relative === "") {
    return;
  }

  let current = root;

  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const info = lstatSync(current, { throwIfNoEntry: false });

    if (!info) {
      return;
    }

    if (info.isSymbolicLink()) {
      throw new Error(`BACKUP_DIR must not contain symbolic links or junctions: ${current}`);
    }
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const comparableRoot = process.platform === "win32" ? root.toLowerCase() : root;
  const comparableCandidate = process.platform === "win32" ? candidate.toLowerCase() : candidate;
  const relative = path.relative(comparableRoot, comparableCandidate);

  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}
