import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const defaultToolOutputSchema = z.object({
  ok: z.boolean(),
  error: z.string().max(1_024).optional(),
}).catchall(z.unknown());

export function defaultOutputToolRegistrar(server: McpServer): McpServer["registerTool"] {
  const registerTool = server.registerTool.bind(server);
  const invokeRegisterTool = registerTool as unknown as (
    name: string,
    config: Record<string, unknown>,
    handler: unknown,
  ) => unknown;

  return ((name, config, handler) => invokeRegisterTool(
    name,
    { outputSchema: defaultToolOutputSchema, ...config },
    handler,
  )) as McpServer["registerTool"];
}
