import { beforeEach, describe, expect, it, vi } from "vitest";

const { billableTool, chargedCredits } = vi.hoisted(() => ({
  chargedCredits: [] as number[],
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

// Mirrors the real helper's contract: credits are only charged once the
// wrapped work resolves, so a rejection leaves `chargedCredits` untouched.
vi.mock("@workspace/credits", () => ({
  runWithCreditCharge: vi.fn(async ({ run, cost }) => {
    const result = await run();
    chargedCredits.push(cost.credits);
    return result;
  }),
}));

import { runWithCreditCharge } from "@workspace/credits";
import { hasAccess } from "@workspace/tool-calls";
import { registerTools } from "./registry";

const ORG_API_KEY_CONTEXT = {
  kind: "api-key",
  keyId: "key_1",
  ownerType: "organization",
  userId: null,
  orgId: "org_1",
  permissions: {},
} as const;

function registerAndGetHandler(ctx: typeof ORG_API_KEY_CONTEXT) {
  let handler!: (args: Record<string, unknown>) => Promise<{ isError?: boolean }>;
  const server = {
    tool: vi.fn((_name, _description, _shape, registeredHandler) => {
      handler = registeredHandler;
    }),
  };
  registerTools(server as never, ctx);
  return handler;
}

describe("registerTools credit wrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chargedCredits.length = 0;
    vi.mocked(hasAccess).mockReturnValue(true);
    billableTool.run.mockResolvedValue({ ok: true });
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

  it("does not charge credits when the caller is not allowed to run the tool", async () => {
    vi.mocked(hasAccess).mockReturnValue(false);

    const result = await registerAndGetHandler(ORG_API_KEY_CONTEXT)({});

    expect(result.isError).toBe(true);
    expect(billableTool.run).not.toHaveBeenCalled();
    expect(runWithCreditCharge).not.toHaveBeenCalled();
    expect(chargedCredits).toEqual([]);
  });

  it("does not charge credits when the tool itself fails", async () => {
    billableTool.run.mockRejectedValue(new Error("tool exploded"));

    const result = await registerAndGetHandler(ORG_API_KEY_CONTEXT)({});

    expect(result.isError).toBe(true);
    expect(runWithCreditCharge).toHaveBeenCalledTimes(1);
    expect(chargedCredits).toEqual([]);
  });

  it("charges once when the tool succeeds", async () => {
    await registerAndGetHandler(ORG_API_KEY_CONTEXT)({});

    expect(chargedCredits).toEqual([5]);
  });
});
