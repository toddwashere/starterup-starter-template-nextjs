import {
  mcpStreamableHttpPost,
  readMcpJsonRpcResponse,
} from "@workspace/common/mcp/http-client";
import { getPublicMcpEndpoint } from "@workspace/common/env/public-mcp";

/**
 * Shared internal helper — posts a JSON-RPC body to the public MCP endpoint.
 * Used by both ai-chat-actions.ts (via import) and this module.
 */
export async function mcpPost(cookie: string, body: unknown): Promise<Response> {
  const endpoint = getPublicMcpEndpoint();
  try {
    return await mcpStreamableHttpPost(endpoint, body, { Cookie: cookie });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot reach MCP server at ${endpoint}. Is public-mcp running? (${message})`,
    );
  }
}

/**
 * Execute a single MCP tool and return the raw JSON-RPC result object.
 *
 * Tool-level errors (isError: true in the result) are returned as-is so the
 * AI model / UI can surface them rather than throwing and losing the content.
 * Network-level or HTTP-level failures do throw.
 */
export async function executeMcpTool(
  cookie: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const res = await mcpPost(cookie, {
    jsonrpc: "2.0",
    id: Date.now(),
    method: "tools/call",
    params: { name: toolName, arguments: args },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `MCP tool call failed (${res.status}) at ${getPublicMcpEndpoint()}${text ? `: ${text.slice(0, 200)}` : ""}`,
    );
  }

  return readMcpJsonRpcResponse(res);
}
