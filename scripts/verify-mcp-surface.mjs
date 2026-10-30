#!/usr/bin/env node

// Protocol-level smoke test for the published MCP surface.
// It starts the built server over stdio with a placeholder token, performs the
// MCP handshake and validates the advertised tools. It never calls a Discord API.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const expectedToolCount = 54;
const expectedAnnotationKeys = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"];
const entrypoint = path.join(projectRoot, "dist", "index.js");

const failures = [];

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

const childEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => typeof value === "string"),
);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint],
  env: { ...childEnvironment, DISCORD_TOKEN: "smoke-test-token", LOG_LEVEL: "error" },
});

const client = new Client({ name: "discord-management-mcp-smoke", version: "1.0.0" }, { capabilities: {} });

try {
  await client.connect(transport);

  const serverVersion = client.getServerVersion();
  check(serverVersion?.name === "discord-management-mcp", `server name is ${String(serverVersion?.name)}`);
  check(
    serverVersion?.version === packageJson.version,
    `server version ${String(serverVersion?.version)} does not match package.json ${packageJson.version}`,
  );

  const instructions = client.getInstructions();
  check(typeof instructions === "string" && instructions.trim().length > 0, "initialize result has no instructions");
  check((instructions ?? "").length <= 2048, "instructions exceed 2048 characters");

  const firstList = await client.listTools();
  const secondList = await client.listTools();
  const tools = firstList.tools;

  check(Array.isArray(tools), "tools/list did not return an array");
  check(tools.length === expectedToolCount, `expected ${expectedToolCount} tools, received ${tools.length}`);
  check(JSON.stringify(firstList) === JSON.stringify(secondList), "tools/list is not deterministic across two calls");

  const names = new Set();
  for (const tool of tools) {
    check(/^discord_[a-z0-9_]+$/.test(tool.name), `${tool.name}: name does not match discord_*`);
    check(!names.has(tool.name), `${tool.name}: duplicate tool name`);
    names.add(tool.name);
    check(typeof tool.title === "string" && tool.title.trim().length > 0, `${tool.name}: missing title`);
    check(typeof tool.description === "string" && tool.description.trim().length > 0, `${tool.name}: missing description`);
    check(tool.inputSchema?.type === "object", `${tool.name}: inputSchema is not an object schema`);
    check(tool.outputSchema?.type === "object", `${tool.name}: outputSchema is not an object schema`);
    check(
      Array.isArray(tool.outputSchema?.required) && tool.outputSchema.required.includes("ok"),
      `${tool.name}: outputSchema does not require ok`,
    );
    for (const key of expectedAnnotationKeys) {
      check(typeof tool.annotations?.[key] === "boolean", `${tool.name}: annotation ${key} is missing`);
    }
  }

  if (failures.length > 0) {
    console.error("MCP surface verification failed:");
    for (const failure of failures) {
      console.error(` - ${failure}`);
    }
    process.exitCode = 1;
  } else {
    const readOnly = tools.filter((tool) => tool.annotations?.readOnlyHint === true).length;
    console.log(
      `MCP surface OK: ${tools.length} tools (${readOnly} read-only), version ${String(serverVersion?.version)}, ` +
        `${(instructions ?? "").length} instruction characters.`,
    );
  }
} catch (error) {
  console.error(`MCP surface verification could not run: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => undefined);
}
