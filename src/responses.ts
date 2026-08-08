type JsonObject = Record<string, unknown>;

export type McpTextContent = {
  type: "text";
  text: string;
};

export type McpResponse<TStructuredContent extends JsonObject> = {
  content: McpTextContent[];
  structuredContent: TStructuredContent & { ok: boolean };
  isError?: true;
};

export function successResponse<TStructuredContent extends JsonObject>(
  text: string,
  structuredContent: TStructuredContent,
): McpResponse<TStructuredContent> {
  return {
    content: [{ type: "text", text }],
    structuredContent: { ...structuredContent, ok: true },
  };
}

export function errorResponse<TStructuredContent extends JsonObject>(
  text: string,
  structuredContent: TStructuredContent,
): McpResponse<TStructuredContent> {
  return {
    content: [{ type: "text", text }],
    structuredContent: { ...structuredContent, ok: false },
    isError: true,
  };
}
