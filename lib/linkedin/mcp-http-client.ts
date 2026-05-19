import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = process.env.LINKEDIN_MCP_URL ?? "http://localhost:8765/mcp";

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const client = new Client({ name: "linkedin-sales-intelligence", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  await client.connect(transport);
  try {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) {
      const msg = (result.content as Array<{ text?: string }>).map((c) => c.text).join(" ");
      throw new Error(`MCP tool error: ${msg}`);
    }
    return result.content;
  } finally {
    await client.close();
  }
}

export async function mcpSendMessage(
  linkedinUsername: string,
  message: string,
  profileUrn?: string
): Promise<void> {
  await callTool("send_message", {
    linkedin_username: linkedinUsername,
    message,
    confirm_send: true,
    ...(profileUrn ? { profile_urn: profileUrn } : {}),
  });
}

export function extractUsername(linkedinUrl: string): string {
  const m = linkedinUrl.match(/linkedin\.com\/in\/([^/?#]+)/);
  if (m) return m[1];
  throw new Error(`Cannot extract LinkedIn username from URL: ${linkedinUrl}`);
}

export function extractProfileUrn(linkedinUrn: string): string | undefined {
  const id = linkedinUrn.split(":").at(-1);
  if (id && id.startsWith("ACo") && id.length > 20) return id;
  return undefined;
}
