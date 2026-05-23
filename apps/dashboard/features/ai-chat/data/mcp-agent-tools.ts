import { tool, jsonSchema } from "ai";
import type { ToolSet } from "ai";

type McpToolEntry = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

function isMcpToolEntry(value: unknown): value is McpToolEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).name === "string" &&
    (value as McpToolEntry).name.length > 0
  );
}

/**
 * Build an AI SDK ToolSet from the MCP tools/list response array.
 *
 * - Each MCP tool `{ name, description?, inputSchema? }` becomes an AI SDK
 *   `tool` whose `execute` delegates to the provided `executeTool` function.
 * - Entries that are not objects or that have no `name` are silently skipped.
 * - The JSON schema for each tool falls back to `{ type: "object", properties: {} }`
 *   when `inputSchema` is absent.
 */
export function buildToolsFromMcpList(
  mcpTools: unknown[],
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
): ToolSet {
  const toolSet: ToolSet = {};

  for (const entry of mcpTools) {
    if (!isMcpToolEntry(entry)) {
      continue;
    }

    const { name, description, inputSchema } = entry;

    const schema = inputSchema ?? { type: "object", properties: {} };

    toolSet[name] = tool({
      description: description ?? name,
      inputSchema: jsonSchema(schema as Parameters<typeof jsonSchema>[0]),
      execute: (args) => executeTool(name, args as Record<string, unknown>),
    });
  }

  return toolSet;
}
