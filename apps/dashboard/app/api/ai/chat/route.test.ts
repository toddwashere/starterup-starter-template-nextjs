import { beforeEach, describe, expect, it, vi } from "vitest";

const { creditsMock } = vi.hoisted(() => ({
  creditsMock: {
    settleModelUsage: vi.fn(async () => ({ id: "creduse_1" })),
    markFailedWithoutCharge: vi.fn(async () => ({ id: "creduse_1" })),
  },
}));

const { TestInsufficientCreditsError } = vi.hoisted(() => ({
  TestInsufficientCreditsError: class extends Error {
    readonly code = "INSUFFICIENT_CREDITS";
    constructor(readonly balanceCredits: number) {
      super("Insufficient credits");
      this.name = "InsufficientCreditsError";
    }
  },
}));

vi.mock("@workspace/credits", () => ({
  beginCreditUsage: vi.fn(async () => creditsMock),
  creditsConfig: { policy: { chargeToOrgDefault: false } },
  InsufficientCreditsError: TestInsufficientCreditsError,
}));

vi.mock("@workspace/auth/guards", () => ({ requireUser: vi.fn() }));
vi.mock("@workspace/auth/session", () => ({
  getCurrentOrg: vi.fn(async () => ({ name: "Acme" })),
}));
vi.mock("@workspace/ai/ai-calls/assistant-chat", () => ({
  askAssistantChat: vi.fn(),
}));
vi.mock("@workspace/ai/keys", () => ({ keys: vi.fn(() => ({})) }));
vi.mock("@workspace/ai/list-available-ai-models", () => ({
  getDefaultAvailableProviderModel: vi.fn(() => "openai:gpt-4o-mini"),
}));
vi.mock("@workspace/ai/ai-models-available", () => ({
  DEFAULT_PROVIDER_MODEL: "openai:gpt-4o-mini",
}));
vi.mock("@workspace/ai/data-models/ai-message-repo", () => ({
  createAiAssistantMessage: vi.fn(async () => ({ id: "aimsg_2" })),
  createAiUserMessage: vi.fn(async () => ({ id: "aimsg_1" })),
  listAiMessagesForThread: vi.fn(async () => []),
}));
vi.mock("@workspace/ai/data-models/ai-thread-repo", () => ({
  getOrCreateActiveAiThread: vi.fn(async () => ({ id: "aithr_1" })),
}));
vi.mock("@/features/ai-chat/data/ai-chat-actions", () => ({
  listMcpToolsAction: vi.fn(async () => []),
}));
vi.mock("@/features/ai-chat/data/mcp-agent-tools", () => ({
  buildToolsFromMcpList: vi.fn(() => ({})),
}));
vi.mock("@/features/ai-chat/data/mcp-tool-executor", () => ({
  executeMcpTool: vi.fn(),
}));
vi.mock("@/features/ai-chat/data/format-tool-summary", () => ({
  formatToolSummary: vi.fn(() => ""),
}));

import { requireUser } from "@workspace/auth/guards";
import { askAssistantChat } from "@workspace/ai/ai-calls/assistant-chat";
import { beginCreditUsage } from "@workspace/credits";
import { POST } from "./route";

function chatRequest() {
  return new Request("http://localhost/api/ai/chat", {
    method: "POST",
    body: JSON.stringify({
      messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
      providerModel: "openai:gpt-4o-mini",
    }),
  });
}

describe("POST /api/ai/chat credit metering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "user_1" },
      session: { activeOrganizationId: "org_1" },
    } as never);
    vi.mocked(beginCreditUsage).mockResolvedValue(creditsMock as never);
  });

  it("returns 402 INSUFFICIENT_CREDITS without calling the model", async () => {
    vi.mocked(beginCreditUsage).mockRejectedValue(new TestInsufficientCreditsError(0));

    const res = await POST(chatRequest());

    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      error: "Insufficient credits",
      code: "INSUFFICIENT_CREDITS",
      balanceCredits: 0,
    });
    expect(askAssistantChat).not.toHaveBeenCalled();
  });

  it("marks the usage failed without charging when the AI call rejects", async () => {
    vi.mocked(askAssistantChat).mockRejectedValue(new Error("Invalid model"));

    const res = await POST(chatRequest());

    expect(res.status).toBe(400);
    expect(creditsMock.markFailedWithoutCharge).toHaveBeenCalledTimes(1);
    expect(creditsMock.settleModelUsage).not.toHaveBeenCalled();
  });

  it("settles model usage only after the stream finishes successfully", async () => {
    let capturedOnFinish!: (args: {
      text: string;
      steps: unknown[];
      usage: unknown;
    }) => Promise<void>;

    vi.mocked(askAssistantChat).mockImplementation((async (input: {
      onFinish: typeof capturedOnFinish;
    }) => {
      capturedOnFinish = input.onFinish;
      return { toUIMessageStreamResponse: () => new Response("stream") };
    }) as unknown as typeof askAssistantChat);

    const res = await POST(chatRequest());
    expect(res.status).toBe(200);
    // Nothing settles until the stream actually finishes.
    expect(creditsMock.settleModelUsage).not.toHaveBeenCalled();

    await capturedOnFinish({
      text: "hi",
      steps: [],
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    expect(creditsMock.settleModelUsage).toHaveBeenCalledWith({
      providerModel: "openai:gpt-4o-mini",
      usage: { inputTokens: 100, outputTokens: 50 },
      metadata: { threadId: "aithr_1" },
    });
    expect(creditsMock.markFailedWithoutCharge).not.toHaveBeenCalled();
  });

  it("meters observe-only while chargeToOrgDefault is false", async () => {
    vi.mocked(askAssistantChat).mockResolvedValue({
      toUIMessageStreamResponse: () => new Response("stream"),
    } as never);

    await POST(chatRequest());

    expect(beginCreditUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        chargeToOrg: false,
        source: "dashboard",
        usageArea: "assistant_chat",
        actor: { kind: "user", userId: "user_1" },
        idempotencyKey: "assistant_chat:aithr_1:aimsg_1",
      }),
    );
  });
});
