type McpToolEntry = { name: string; description?: string };

function isMcpToolEntry(value: unknown): value is McpToolEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).name === "string" &&
    (value as McpToolEntry).name.length > 0
  );
}

/**
 * Render the MCP tools/list response into the assistant prompt's `{{toolSummary}}`
 * variable: a titled Markdown bullet list. Returns `undefined` when no valid
 * tools are available so the prompt's optional block is omitted entirely (the
 * placeholder renders to nothing rather than leaving an orphan header).
 */
export function formatToolSummary(mcpTools: unknown[]): string | undefined {
  const lines = mcpTools
    .filter(isMcpToolEntry)
    .map((tool) =>
      tool.description ? `- ${tool.name}: ${tool.description}` : `- ${tool.name}`,
    );

  return lines.length > 0 ? `Available tools:\n${lines.join("\n")}` : undefined;
}
