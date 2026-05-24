import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  streamText: vi.fn(() => ({ __stream: true })),
  generateText: vi.fn(async () => ({ __generate: true, text: "ok", steps: [] })),
  stepCountIs: vi.fn((n: number) => ({ __stepCount: n })),
}));
vi.mock("./get-model", () => ({
  getModel: vi.fn(() => ({ __model: true })),
}));
vi.mock("./log-ai-call", () => ({
  logAiCall: vi.fn(),
}));

import { generateText, streamText, stepCountIs } from "ai";
import { z } from "zod";
import { askAi } from "./ask-ai";
import { defineAiCall } from "./define-ai-call";
import { getModel } from "./get-model";
import { logAiCall } from "./log-ai-call";

const fixtureUrl = new URL(
  "./__fixtures__/sample-call/sample-call.ts",
  import.meta.url,
).href;

const streamCall = defineAiCall({
  id: "test-stream",
  importMetaUrl: fixtureUrl,
  prompt: "./prompt.md",
  preset: "assistant",
  mode: "stream",
  variables: z.object({ name: z.string() }),
});

const generateCall = defineAiCall({
  id: "test-generate",
  importMetaUrl: fixtureUrl,
  prompt: "./prompt.md",
  preset: "worker",
  mode: "generate",
  variables: z.object({ name: z.string() }),
});

const mockedStreamText = streamText as ReturnType<typeof vi.fn>;
const mockedGenerateText = generateText as ReturnType<typeof vi.fn>;
const mockedStepCountIs = stepCountIs as ReturnType<typeof vi.fn>;
const mockedGetModel = getModel as ReturnType<typeof vi.fn>;
const mockedLogAiCall = logAiCall as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("LANGFUSE_PUBLIC_KEY", "");
  vi.stubEnv("LANGFUSE_SECRET_KEY", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("askAi() — stream mode", () => {
  it("renders the prompt as the system string and forwards messages/tools", async () => {
    const result = await askAi(streamCall, {
      messages: [{ role: "user", content: "hi" }],
      tools: {},
      variables: { name: "Acme" },
      context: { userId: "u1", orgId: "o1" },
    });

    expect(mockedStreamText).toHaveBeenCalledOnce();
    const arg = mockedStreamText.mock.lastCall![0] as Record<string, unknown>;
    expect(arg.system).toBe("Hello Acme\n");
    expect(arg.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(result).toEqual({ __stream: true });
  });

  it("uses the preset's step cap and generation params", async () => {
    await askAi(streamCall, { variables: { name: "Acme" } });

    expect(mockedStepCountIs).toHaveBeenCalledWith(5); // assistant preset
    const arg = mockedStreamText.mock.lastCall![0] as Record<string, unknown>;
    expect(arg.temperature).toBe(0.7);
    expect(arg.maxOutputTokens).toBe(4096);
  });

  it("logs the call with the call id as functionId", async () => {
    await askAi(streamCall, { variables: { name: "Acme" } });

    expect(mockedLogAiCall).toHaveBeenCalledWith(
      expect.objectContaining({
        functionId: "test-stream",
        providerModel: "openrouter:anthropic/claude-sonnet-4",
      }),
    );
  });

  it("rejects invalid variables before calling the SDK", async () => {
    await expect(
      askAi(streamCall, { variables: { name: 123 as unknown as string } }),
    ).rejects.toThrow();
    expect(mockedStreamText).not.toHaveBeenCalled();
  });

  it("applies a validated providerModel override", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");

    await askAi(streamCall, {
      variables: { name: "Acme" },
      overrides: { providerModel: "openrouter:openai/gpt-4o-mini" },
    });

    expect(mockedGetModel).toHaveBeenCalledWith({
      providerModel: "openrouter:openai/gpt-4o-mini",
    });
  });

  it("throws when an override providerModel is not configured", async () => {
    // anthropic direct has no key configured here
    await expect(
      askAi(streamCall, {
        variables: { name: "Acme" },
        overrides: { providerModel: "anthropic:claude-sonnet-4-20250514" },
      }),
    ).rejects.toThrow(/configured|anthropic/i);
  });
});

describe("askAi() — generate mode", () => {
  it("calls generateText with the user prompt and rendered system", async () => {
    const result = await askAi(generateCall, {
      prompt: "Summarize this.",
      variables: { name: "Acme" },
    });

    expect(mockedGenerateText).toHaveBeenCalledOnce();
    const arg = mockedGenerateText.mock.lastCall![0] as Record<string, unknown>;
    expect(arg.prompt).toBe("Summarize this.");
    expect(arg.system).toBe("Hello Acme\n");
    expect(mockedStepCountIs).toHaveBeenCalledWith(1); // worker preset
    expect(result).toEqual({ __generate: true, text: "ok", steps: [] });
  });
});
