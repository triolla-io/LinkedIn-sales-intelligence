export type McpErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid"
  | "conflict";

export class McpError extends Error {
  constructor(public code: McpErrorCode, message: string) {
    super(message);
    this.name = "McpError";
  }
}

/** Standard success tool result: pretty-printed JSON text. */
export function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/** Standard error tool result: structured, never leaks internals. */
export function toolError(err: unknown) {
  const code = err instanceof McpError ? err.code : "invalid";
  const message =
    err instanceof McpError ? err.message : "Unexpected error handling the request";
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify({ error: code, message }, null, 2) }],
  };
}
