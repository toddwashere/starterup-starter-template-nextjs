import { beforeEach, describe, expect, it, vi } from "vitest";

import { runWorkerExample } from "@workspace/ai/ai-calls/worker-example";
import { beginCreditUsage } from "@workspace/credits";

import { handleAiExample } from "./ai-example";

vi.mock("@workspace/ai/ai-calls/worker-example", () => ({
  runWorkerExample: vi.fn(async () => ({
    text: "hello world",
    usage: { inputTokens: 10, outputTokens: 5 },
  })),
}));

const settleModelUsage = vi.fn();
const markFailedWithoutCharge = vi.fn();

vi.mock("@workspace/credits", () => ({
  creditsConfig: { policy: { chargeToOrgDefault: false } },
  beginCreditUsage: vi.fn(async () => ({
    settleModelUsage,
    markFailedWithoutCharge,
  })),
}));

const mockedRun = runWorkerExample as ReturnType<typeof vi.fn>;
const mockedBeginCreditUsage = beginCreditUsage as ReturnType<typeof vi.fn>;

describe("handleAiExample", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settleModelUsage.mockReset();
    markFailedWithoutCharge.mockReset();
    mockedRun.mockResolvedValue({
      text: "hello world",
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);
  });

  it("calls runWorkerExample with the payload text as inputText", async () => {
    await handleAiExample({ text: "summarize this" });

    expect(mockedRun).toHaveBeenCalledOnce();
    expect(mockedRun).toHaveBeenCalledWith({
      variables: { inputText: "summarize this" },
      context: {
        orgId: undefined,
        userId: undefined,
      },
    });
  });

  it("settles credits after a successful org-scoped worker AI call", async () => {
    await handleAiExample({
      text: "summarize this",
      organizationId: "org_1",
      userId: "user_1",
      chargeToOrg: true,
    });

    expect(mockedBeginCreditUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        usageArea: "worker_ai_call",
        source: "worker",
        actor: { kind: "user", userId: "user_1" },
        chargeToOrg: true,
      }),
    );
    expect(settleModelUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
    );
  });

  it("skips with a warning when the worker model is not configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockedRun.mockRejectedValueOnce(
      new Error("AI provider 'openai' requires OPENAI_API_KEY to be set"),
    );

    await handleAiExample({ text: "summarize this" });

    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/skip/i));
    warn.mockRestore();
  });

  it("marks org-scoped credit usage failed without charging when the AI call fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockedRun.mockRejectedValueOnce(new Error("not configured"));

    await handleAiExample({ text: "summarize this", organizationId: "org_1" });

    expect(markFailedWithoutCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ error: "not configured" }),
      }),
    );
    expect(settleModelUsage).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
