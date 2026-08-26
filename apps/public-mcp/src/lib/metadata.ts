import type { ServerResponse } from "node:http";
import { keys as authKeys } from "@workspace/auth/keys";
import { getPublicMcpUrl } from "@workspace/common/env/public-mcp";

export function writeProtectedResourceMetadata(res: ServerResponse): void {
  const metadata = {
    resource: getPublicMcpUrl(),
    authorization_servers: [authKeys().BETTER_AUTH_URL],
    scopes_supported: ["account:read", "offline_access"],
  };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(metadata));
}

export function getWwwAuthenticateHeader(): string {
  const metadataUrl = `${getPublicMcpUrl()}/.well-known/oauth-protected-resource`;
  return `Bearer realm="MCP", resource_metadata="${metadataUrl}"`;
}
