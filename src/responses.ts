type JsonObject = Record<string, unknown>;

export type McpTextContent = {
  type: "text";
  text: string;
};

export type McpResponse<TStructuredContent extends JsonObject> = {
  content: McpTextContent[];
  structuredContent: TStructuredContent;
  isError?: true;
};

export function successResponse<TStructuredContent extends JsonObject>(
  text: string,
  structuredContent: TStructuredContent,
): McpResponse<TStructuredContent> {
  return {
    content: [{ type: "text", text }],
    structuredContent,
  };
}

export function errorResponse<TStructuredContent extends JsonObject>(
  text: string,
  structuredContent: TStructuredContent,
): McpResponse<TStructuredContent> {
  return {
    content: [{ type: "text", text }],
    structuredContent,
    isError: true,
  };
}
