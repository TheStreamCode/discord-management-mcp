import { afterEach, describe, expect, test, vi } from "vitest";
import { createLogger, isLogLevel, LOG_LEVELS, type Logger } from "../logger.js";

type CapturedWrite = { stream: "stderr" | "stdout"; chunk: string };

function captureWrites(): CapturedWrite[] {
  const writes: CapturedWrite[] = [];

  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    writes.push({ stream: "stderr", chunk: String(chunk) });
    return true;
  });
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    writes.push({ stream: "stdout", chunk: String(chunk) });
    return true;
  });

  return writes;
}

function parseLines(writes: CapturedWrite[]): Array<Record<string, unknown>> {
  return writes
    .filter((write) => write.stream === "stderr")
    .map((write) => JSON.parse(write.chunk.trim()) as Record<string, unknown>);
}

describe("createLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("writes one JSON line per record to stderr only", () => {
    const writes = captureWrites();
    const logger = createLogger("info");

    logger.info("server ready", { version: "0.2.0" });

    expect(writes.some((write) => write.stream === "stdout")).toBe(false);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.chunk.endsWith("\n")).toBe(true);

    const [record] = parseLines(writes);
    expect(record).toMatchObject({
      level: "info",
      message: "server ready",
      version: "0.2.0",
    });
    expect(typeof record?.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(String(record?.timestamp)))).toBe(false);
  });

  test("filters records below the configured level", () => {
    const writes = captureWrites();
    const logger: Logger = createLogger("warn");

    logger.debug("debug message");
    logger.info("info message");
    logger.warn("warn message");
    logger.error("error message");

    const levels = parseLines(writes).map((record) => record.level);
    expect(levels).toEqual(["warn", "error"]);
  });

  test("emits everything at the debug level", () => {
    const writes = captureWrites();
    const logger = createLogger("debug");

    logger.debug("debug message");
    logger.info("info message");
    logger.warn("warn message");
    logger.error("error message");

    expect(parseLines(writes)).toHaveLength(4);
  });

  test("redacts Discord tokens and webhook URLs from messages and fields", () => {
    const writes = captureWrites();
    const logger = createLogger("info");
    const token = "abcdefghijklmnopqrstuv.wxyzab.abcdefghijklmnopqrstuv";
    const webhook = "https://discord.com/api/webhooks/123456789/secret-token";

    logger.error("login failed", { error: `invalid token ${token}`, nested: { webhook } });

    const serialized = writes.map((write) => write.chunk).join("");
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain("secret-token");
    expect(serialized).toContain("[redacted Discord token]");
    expect(serialized).toContain("[redacted Discord webhook]");
  });

  test("turns Error instances into redacted strings", () => {
    const writes = captureWrites();
    const logger = createLogger("info");
    const token = "abcdefghijklmnopqrstuv.wxyzab.abcdefghijklmnopqrstuv";

    logger.error("mutation failed", { error: new Error(`request rejected for ${token}`) });

    const [record] = parseLines(writes);
    expect(record?.error).toBe("request rejected for [redacted Discord token]");
  });

  test("never throws on circular fields and marks them truncated", () => {
    const writes = captureWrites();
    const logger = createLogger("info");
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => logger.info("circular", { circular })).not.toThrow();

    const [record] = parseLines(writes);
    expect(JSON.stringify(record)).toContain("[truncated]");
  });

  test("exposes the supported level enum", () => {
    expect(LOG_LEVELS).toEqual(["error", "warn", "info", "debug"]);
    expect(isLogLevel("info")).toBe(true);
    expect(isLogLevel("verbose")).toBe(false);
  });
});
