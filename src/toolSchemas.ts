import { z } from "zod";

export const discordSnowflakeSchema = z
  .string()
  .regex(/^\d{17,20}$/, "expected a Discord snowflake containing 17 to 20 digits");

export const auditReasonSchema = z.string().trim().min(1).max(512).optional();

export const backupIdInputSchema = z.string().trim().min(1).max(255);

export function requireAtLeastOneInputField(
  value: Record<string, unknown>,
  fields: readonly string[],
  message = "At least one field to update is required.",
): void {
  if (!fields.some((field) => value[field] !== undefined)) {
    throw new Error(message);
  }
}

export function requireUniqueValues(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${field} must not contain duplicate values.`);
  }
}

export function enumMember<T extends string | number>(
  value: string | number,
  values: Record<string, string | number>,
  field: string,
): T {
  const namedCandidate = typeof value === "string" && value in values ? values[value] : value;
  const numericCandidate = typeof namedCandidate === "number"
    ? namedCandidate
    : typeof value === "string" && /^-?\d+$/.test(value)
      ? Number(value)
      : value;
  const validValues = new Set(
    Object.values(values).filter((entry): entry is number => typeof entry === "number"),
  );

  if (typeof numericCandidate === "number" && Number.isInteger(numericCandidate) && validValues.has(numericCandidate)) {
    return numericCandidate as T;
  }

  throw new Error(`Invalid ${field}: ${String(value)}`);
}
