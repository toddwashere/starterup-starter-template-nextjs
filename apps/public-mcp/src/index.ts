import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { resolveMcpAuthContext, McpAuthError } from "./middleware/mcp-auth";
import { writeJsonError } from "./lib/errors";
import { writeProtectedResourceMetadata, getWwwAuthenticateHeader } from "./lib/metadata";
import {
  assertPublicMcpEnv,
  getPublicMcpListenPort,
  getPublicMcpUrl,
} from "@workspace/common/env/public-mcp";
import { registerTools } from "./tools/registry";

assertPublicMcpEnv();

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (req.method !== "POST") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString();
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = req.url ?? "";
  const pathname = url.split("?")[0] ?? "";

  // Liveness for App Runner / load balancers — no auth, no side effects.
  if (pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // OAuth protected-resource metadata — required for MCP client OAuth discovery
  if (pathname === "/.well-known/oauth-protected-resource") {
    writeProtectedResourceMetadata(res);
    return;
  }

  if (!pathname.startsWith("/mcp")) {
    writeJsonError(res, 404, "NOT_FOUND", "Not found");
    return;
  }

  let authContext;
  try {
    authContext = await resolveMcpAuthContext(req);
  } catch (err) {
    if (err instanceof McpAuthError) {
      const status = err.code === "RATE_LIMITED" ? 429 : 401;
      if (status === 401) {
        res.setHeader("WWW-Authenticate", getWwwAuthenticateHeader());
      }
      writeJsonError(res, status, err.code, err.message);
    } else {
      writeJsonError(res, 500, "INTERNAL_ERROR", "Internal server error");
    }
    return;
  }

  const body = await readBody(req);
  const mcpServer = new McpServer({ name: "public-mcp", version: "1.0.0" });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  registerTools(mcpServer, authContext);
  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, body);
});

const port = getPublicMcpListenPort();
server.listen(port, "0.0.0.0", () => {
  console.log(`Public MCP server listening on 0.0.0.0:${port}`);
  console.log(`Public MCP endpoint: ${getPublicMcpUrl()}/mcp`);
});
