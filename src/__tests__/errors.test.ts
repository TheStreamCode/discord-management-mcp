import { describe, expect, test } from "vitest";
import { safeErrorMessage } from "../errors.js";

describe("safe error messages", () => {
  test("redacts Discord credentials, invite URLs, authorization headers, and local paths", () => {
    const message = safeErrorMessage(new Error(
      `Authorization: Bot abc\nhttps://discord.gg/secret `
      + `https://discord.com/api/webhooks/12345678901234567/token-value ${process.cwd()}\\.env.local`,
    ));

    expect(message).toContain("Authorization: [redacted]");
    expect(message).toContain("[redacted Discord invite]");
    expect(message).toContain("[redacted Discord webhook]");
    expect(message).toContain("[project]");
    expect(message).not.toContain("token-value");
    expect(message).not.toContain("secret");
  });
});
