import { describe, expect, it, vi } from "vitest";
import { buildToolsFromMcpList } from "./mcp-agent-tools";

const FIXTURE_TOOLS = [
  {
    name: "account-info",
    description: "Returns information about the current account.",
    inputSchema: { type: "object", properties: {} },
  },
  // malformed: no name
  {},
  // malformed: null
  null,
  // malformed: non-object
  "not-an-object",
  // malformed: name is not a string
  { name: 42, description: "bad entry" },
];

describe("buildToolsFromMcpList", () => {
  it("includes well-formed tools in the returned ToolSet", () => {
    const executeTool = vi.fn();
    const tools = buildToolsFromMcpList(FIXTURE_TOOLS, executeTool);

    expect(Object.keys(tools)).toContain("account-info");
  });

  it("skips malformed entries (no name, null, non-object) without throwing", () => {
    const executeTool = vi.fn();

    expect(() => buildToolsFromMcpList(FIXTURE_TOOLS, executeTool)).not.toThrow();

    const tools = buildToolsFromMcpList(FIXTURE_TOOLS, executeTool);
    // Only the valid "account-info" entry should appear
    expect(Object.keys(tools)).toEqual(["account-info"]);
  });

  it("delegates execute() to the provided executeTool with (name, args)", async () => {
    const executeTool = vi.fn().mockResolvedValue({ balance: 42 });

    const tools = buildToolsFromMcpList(FIXTURE_TOOLS, executeTool);
    const accountTool = tools["account-info"];

    expect(accountTool).toBeDefined();
    expect(typeof accountTool?.execute).toBe("function");

    const args = { userId: "u_123" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (accountTool as any).execute(args, {} as any);

    expect(executeTool).toHaveBeenCalledWith("account-info", args);
    expect(result).toEqual({ balance: 42 });
  });
});
