import { beforeEach, describe, expect, it, vi } from "vitest";

import { runWorkerExample } from "@workspace/ai/ai-calls/worker-example";

import { handleAiExample } from "./ai-example";

vi.mock("@workspace/ai/ai-calls/worker-example", () => ({
  runWorkerExample: vi.fn(async () => ({ text: "hello world" })),
}));

const mockedRun = runWorkerExample as ReturnType<typeof vi.fn>;

describe("handleAiExample", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRun.mockResolvedValue({ text: "hello world" } as never);
  });

  it("calls runWorkerExample with the payload text as inputText", async () => {
    await handleAiExample({ text: "summarize this" });

    expect(mockedRun).toHaveBeenCalledOnce();
    expect(mockedRun).toHaveBeenCalledWith({
      variables: { inputText: "summarize this" },
    });
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
});
