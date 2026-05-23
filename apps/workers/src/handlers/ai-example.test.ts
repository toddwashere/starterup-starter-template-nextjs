import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateText } from "ai";

import { getModel } from "@workspace/ai";

import { handleAiExample } from "./ai-example";

vi.mock("ai", () => ({
  generateText: vi.fn().mockResolvedValue({ text: "hello world" }),
}));
vi.mock("@workspace/ai", () => ({
  resolveAiCallOptions: vi.fn(() => ({
    providerModel: "openai:gpt-4o-mini",
    maxSteps: 1,
    temperature: 0,
    maxOutputTokens: 1024,
  })),
  getModel: vi.fn(() => ({})),
  getGenerationParams: vi.fn(() => ({})),
  buildTelemetryOptions: vi.fn(() => ({})),
  logAiCall: vi.fn(),
}));
vi.mock("@workspace/ai/prompts/assistant-system", () => ({
  ASSISTANT_SYSTEM_PROMPT: "sys",
}));

const mockGenerateText = vi.mocked(generateText);
const mockGetModel = vi.mocked(getModel);

describe("handleAiExample", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateText.mockResolvedValue({
      text: "hello world",
    } as Awaited<ReturnType<typeof generateText>>);
    mockGetModel.mockReturnValue({} as ReturnType<typeof getModel>);
  });

  it("calls generateText exactly once when the worker model is available", async () => {
    await handleAiExample({ text: "summarize this" });

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });

  it("passes the payload text as the prompt", async () => {
    await handleAiExample({ text: "summarize this" });

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "summarize this" }),
    );
  });

  it("skips with a warning when the worker model is not configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockGetModel.mockImplementationOnce(() => {
      throw new Error(
        "AI provider 'openai' requires OPENAI_API_KEY to be set",
      );
    });

    await handleAiExample({ text: "summarize this" });

    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/skip/i));
    warn.mockRestore();
  });
});
