import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthContext } from "../lib/context";
import { toolRegistry, hasAccess } from "@workspace/tool-calls";
import { createId } from "@workspace/common";
import { runWithCreditCharge } from "@workspace/credits";
import { logToolCall } from "../lib/audit";

function actorFromContext(ctx: AuthContext) {
  if (ctx.kind === "api-key") {
    return { kind: "api_key" as const, apiKeyId: ctx.keyId, userId: ctx.userId };
  }
  if (ctx.kind === "oauth") {
    return {
      kind: "oauth_client" as const,
      oauthClientId: ctx.clientId ?? "unknown",
      userId: ctx.userId,
    };
  }
  return { kind: "user" as const, userId: ctx.userId };
}

export function registerTools(server: McpServer, ctx: AuthContext): void {
  for (const tool of toolRegistry) {
    const shape = tool.inputShape ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    server.tool(
      tool.name,
      tool.description,
      shape as any,
      async (args: Record<string, unknown>) => {
        if (!hasAccess(ctx, tool)) {
          void logToolCall({ toolName: tool.name, ctx, success: false, errorCode: "FORBIDDEN" });
          return {
            content: [
              {
                type: "text" as const,
                text: `Forbidden: missing required permission for ${tool.name}`,
              },
            ],
            isError: true,
          };
        }
        try {
          const runTool = () => tool.run(ctx, args);
          const result =
            tool.creditPolicy && ctx.orgId
              ? await runWithCreditCharge({
                  organizationId: ctx.orgId,
                  actor: actorFromContext(ctx),
                  source: "public_mcp",
                  usageArea: tool.creditPolicy.usageArea,
                  chargeToOrg: tool.creditPolicy.chargeToOrg,
                  cost: tool.creditPolicy.cost,
                  idempotencyKey: `mcp:${tool.name}:${createId("creduse")}`,
                  metadata: { toolName: tool.name, authKind: ctx.kind },
                  run: runTool,
                })
              : await runTool();
          void logToolCall({ toolName: tool.name, ctx, success: true });
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          void logToolCall({
            toolName: tool.name,
            ctx,
            success: false,
            errorCode: "INTERNAL_ERROR",
          });
          console.error(`[mcp] Tool ${tool.name} failed:`, err);
          return {
            content: [{ type: "text" as const, text: "Internal error" }],
            isError: true,
          };
        }
      },
    );
  }
}
