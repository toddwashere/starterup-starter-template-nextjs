import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateText } from "ai";

import { handleAiExample } from "./ai-example";

vi.mock("ai", () => ({
  generateText: vi.fn().mockResolvedValue({ text: "hello world" }),
}));
vi.mock("@workspace/ai", () => ({
  getModel: vi.fn(() => ({})),
  getGenerationDefaults: vi.fn(() => ({})),
  buildTelemetryOptions: vi.fn(() => ({})),
}));
vi.mock("@workspace/ai/prompts/assistant-system", () => ({
  ASSISTANT_SYSTEM_PROMPT: "sys",
}));

const mockGenerateText = vi.mocked(generateText);

describe("handleAiExample", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls generateText exactly once", async () => {
    await handleAiExample({ text: "summarize this" });

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });

  it("passes the payload text as the prompt", async () => {
    await handleAiExample({ text: "summarize this" });

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "summarize this" }),
    );
  });
});
