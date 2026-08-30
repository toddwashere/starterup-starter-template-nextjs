import { beforeEach, describe, expect, it, vi } from "vitest";

const { billableTool } = vi.hoisted(() => ({
  billableTool: {
    name: "billable-tool",
    description: "Billable tool",
    requiredScopes: [],
    requiredPermissions: {},
    creditPolicy: {
      chargeToOrg: true,
      usageArea: "mcp_tool",
      cost: { mode: "fixed", credits: 5 },
    },
    run: vi.fn(async () => ({ ok: true })),
  },
}));

vi.mock("@workspace/tool-calls", () => ({
  toolRegistry: [billableTool],
  hasAccess: vi.fn(() => true),
}));

vi.mock("../lib/audit", () => ({
  logToolCall: vi.fn(),
}));

vi.mock("@workspace/credits", () => ({
  runWithCreditCharge: vi.fn(async ({ run }) => run()),
}));

import { runWithCreditCharge } from "@workspace/credits";
import { registerTools } from "./registry";

describe("registerTools credit wrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("charges successful billable MCP tools through the credits package", async () => {
    let handler!: (args: Record<string, unknown>) => Promise<unknown>;
    const server = {
      tool: vi.fn((_name, _description, _shape, registeredHandler) => {
        handler = registeredHandler;
      }),
    };
    const ctx = {
      kind: "api-key",
      keyId: "key_1",
      ownerType: "organization",
      userId: null,
      orgId: "org_1",
      permissions: {},
    } as const;

    registerTools(server as never, ctx);
    await handler({});

    expect(runWithCreditCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        chargeToOrg: true,
        source: "public_mcp",
        usageArea: "mcp_tool",
        cost: { mode: "fixed", credits: 5 },
        actor: { kind: "api_key", apiKeyId: "key_1", userId: null },
      }),
    );
  });
});
