import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  streamText: vi.fn(),
  generateText: vi.fn(async () => ({ text: "ok", steps: [] })),
  stepCountIs: vi.fn((n: number) => ({ __stepCount: n })),
}));
vi.mock("../../platform/get-model", () => ({
  getModel: vi.fn(() => ({ __model: true })),
}));

import { generateText } from "ai";
import { call, runWorkerExample } from "./worker-example";

const mockedGenerateText = generateText as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("LANGFUSE_PUBLIC_KEY", "");
  vi.stubEnv("LANGFUSE_SECRET_KEY", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("worker-example call", () => {
  it("is a generate-mode call on the worker preset", () => {
    expect(call.id).toBe("worker-example");
    expect(call.preset).toBe("worker");
    expect(call.mode).toBe("generate");
  });
});

describe("runWorkerExample()", () => {
  it("passes inputText as the generateText prompt and uses the worker preset", async () => {
    await runWorkerExample({ variables: { inputText: "Summarize this." } });

    expect(mockedGenerateText).toHaveBeenCalledOnce();
    const arg = mockedGenerateText.mock.lastCall![0] as {
      prompt: string;
      system: string;
    };
    expect(arg.prompt).toBe("Summarize this.");
    expect(typeof arg.system).toBe("string");
    expect(arg.system.length).toBeGreaterThan(0);
  });

  it("rejects an empty inputText before calling the SDK", async () => {
    await expect(
      runWorkerExample({ variables: { inputText: "" } }),
    ).rejects.toThrow();
    expect(mockedGenerateText).not.toHaveBeenCalled();
  });
});
