import { GuildVerificationLevel } from "discord.js";
import { describe, expect, test } from "vitest";
import {
  discordSnowflakeSchema,
  enumMember,
  requireAtLeastOneInputField,
  requireUniqueValues,
} from "../toolSchemas.js";

describe("shared tool input guards", () => {
  test("accepts bounded snowflakes and real enum members", () => {
    expect(discordSnowflakeSchema.parse("12345678901234567")).toBe("12345678901234567");
    expect(enumMember("High", GuildVerificationLevel, "verificationLevel"))
      .toBe(GuildVerificationLevel.High);
    expect(enumMember(String(GuildVerificationLevel.High), GuildVerificationLevel, "verificationLevel"))
      .toBe(GuildVerificationLevel.High);
  });

  test("rejects malformed IDs, unknown enum numbers, no-op updates, and duplicate IDs", () => {
    expect(() => discordSnowflakeSchema.parse("guild-1")).toThrow();
    expect(() => enumMember(999, GuildVerificationLevel, "verificationLevel")).toThrow("Invalid verificationLevel");
    expect(() => requireAtLeastOneInputField({ reason: "audit" }, ["name", "description"]))
      .toThrow("At least one field");
    expect(() => requireUniqueValues(["1", "1"], "ids")).toThrow("duplicate");
  });
});
