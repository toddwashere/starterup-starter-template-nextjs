import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock the AI SDK before importing the module under test.
// `generateText` is mocked as a vi.fn() that resolves with a fixed value.
// `stepCountIs` is mocked as a sentinel factory so we can assert the argument.
// ---------------------------------------------------------------------------
vi.mock("ai", () => ({
  generateText: vi.fn().mockResolvedValue({
    text: "done",
    steps: [],
    usage: { totalTokens: 1 },
  }),
  stepCountIs: vi.fn((n: number) => ({ __stepCount: n })),
  tool: vi.fn((t: unknown) => t),
}));

// ---------------------------------------------------------------------------
// Mock getModel so no real provider is constructed, and mock logAiCall so we
// can assert run-agent records the canonical model string.
// ---------------------------------------------------------------------------
vi.mock("./get-model", () => ({
  getModel: vi.fn(() => ({})),
}));
vi.mock("./log-ai-call", () => ({
  logAiCall: vi.fn(),
}));

import { generateText, stepCountIs } from "ai";
import type { ModelMessage, ToolSet } from "ai";
import { getModel } from "./get-model";
import { logAiCall } from "./log-ai-call";
import { runAgent, wireToolExecution } from "./run-agent";

// Typed helpers for mocked functions
const mockedGenerateText = generateText as ReturnType<typeof vi.fn>;
const mockedStepCountIs = stepCountIs as ReturnType<typeof vi.fn>;
const mockedGetModel = getModel as ReturnType<typeof vi.fn>;
const mockedLogAiCall = logAiCall as ReturnType<typeof vi.fn>;

/** Return the first argument of the most-recent generateText call. */
function lastGenerateTextCall(): Record<string, unknown> {
  const lastCall = mockedGenerateText.mock.lastCall;
  if (!lastCall) throw new Error("generateText was not called");
  return lastCall[0] as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Unit tests for wireToolExecution (pure — no SDK mock needed)
// ---------------------------------------------------------------------------

describe("wireToolExecution()", () => {
  it("calls executeTool with the tool name and args", async () => {
    const executeTool = vi.fn().mockResolvedValue("result-value");
    const inputTool = {
      description: "Get account info",
      inputSchema: { type: "object" as const, properties: {} },
    };

    const wired = wireToolExecution(
      { accountInfo: inputTool } as unknown as ToolSet,
      executeTool,
    );

    const result = await (wired.accountInfo as { execute: Function }).execute({
      q: 1,
    });

    expect(executeTool).toHaveBeenCalledOnce();
    expect(executeTool).toHaveBeenCalledWith("accountInfo", { q: 1 });
    expect(result).toBe("result-value");
  });

  it("propagates errors thrown by executeTool", async () => {
    const executeTool = vi.fn().mockRejectedValue(new Error("tool failed"));
    const inputTool = {
      description: "Boom",
      inputSchema: { type: "object" as const, properties: {} },
    };

    const wired = wireToolExecution(
      { boom: inputTool } as unknown as ToolSet,
      executeTool,
    );

    await expect(
      (wired.boom as { execute: Function }).execute({}),
    ).rejects.toThrow("tool failed");
  });

  it("preserves description and inputSchema from the original tool", () => {
    const executeTool = vi.fn();
    const inputTool = {
      description: "My tool",
      inputSchema: { type: "object" as const },
      extra: "preserved",
    };

    const wired = wireToolExecution(
      { myTool: inputTool } as unknown as ToolSet,
      executeTool,
    );

    expect((wired.myTool as { description: string }).description).toBe(
      "My tool",
    );
  });

  it("uses the record KEY as the tool name passed to executeTool", async () => {
    const executeTool = vi.fn().mockResolvedValue(null);
    const wired = wireToolExecution(
      { search_contacts: { description: "Search" } } as unknown as ToolSet,
      executeTool,
    );

    await (wired.search_contacts as { execute: Function }).execute({ term: "a" });

    expect(executeTool).toHaveBeenCalledWith("search_contacts", { term: "a" });
  });
});

// ---------------------------------------------------------------------------
// Integration-level tests for runAgent (SDK mocked)
// ---------------------------------------------------------------------------

describe("runAgent()", () => {
  const baseMessages: ModelMessage[] = [{ role: "user", content: "Hello" }];
  const baseTools: ToolSet = {
    noop: {
      description: "noop",
      inputSchema: { type: "object" as const, properties: {} },
    } as unknown as ToolSet[string],
  };

  beforeEach(() => {
    // Ensure no Langfuse keys so telemetry is disabled (deterministic)
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "");
  });

  it("defaults to the assistant preset's maxSteps (5) when no call or maxSteps given", async () => {
    await runAgent({
      messages: baseMessages,
      system: "You are a helper.",
      tools: baseTools,
    });

    expect(mockedStepCountIs).toHaveBeenCalledWith(5);
    const call = lastGenerateTextCall();
    expect(call.stopWhen).toEqual({ __stepCount: 5 });
  });

  it("uses the selected preset's maxSteps", async () => {
    await runAgent({
      messages: baseMessages,
      system: "sys",
      tools: baseTools,
      call: { preset: "worker" },
    });

    expect(mockedStepCountIs).toHaveBeenCalledWith(1);
  });

  it("calls stepCountIs with explicit maxSteps override when provided", async () => {
    await runAgent({
      messages: baseMessages,
      system: "You are a helper.",
      tools: baseTools,
      maxSteps: 2,
    });

    expect(mockedStepCountIs).toHaveBeenCalledWith(2);
    const call = lastGenerateTextCall();
    expect(call.stopWhen).toEqual({ __stepCount: 2 });
  });

  it("builds the model from the resolved providerModel (assistant default)", async () => {
    await runAgent({
      messages: baseMessages,
      system: "sys",
      tools: baseTools,
    });

    expect(mockedGetModel).toHaveBeenCalledWith({
      providerModel: "openrouter:anthropic/claude-sonnet-4",
    });
  });

  it("applies a providerModel override from call.overrides", async () => {
    await runAgent({
      messages: baseMessages,
      system: "sys",
      tools: baseTools,
      call: {
        preset: "assistant",
        overrides: { providerModel: "anthropic:claude-sonnet-4-20250514" },
      },
    });

    expect(mockedGetModel).toHaveBeenCalledWith({
      providerModel: "anthropic:claude-sonnet-4-20250514",
    });
  });

  it("spreads generation params from the resolved preset", async () => {
    await runAgent({
      messages: baseMessages,
      system: "sys",
      tools: baseTools,
    });

    const call = lastGenerateTextCall();
    expect(call.temperature).toBe(0.7);
    expect(call.maxOutputTokens).toBe(4096);
  });

  it("logs the canonical providerModel via logAiCall", async () => {
    await runAgent({
      messages: baseMessages,
      system: "sys",
      tools: baseTools,
      telemetry: { functionId: "ai.test" },
    });

    expect(mockedLogAiCall).toHaveBeenCalledWith(
      expect.objectContaining({
        functionId: "ai.test",
        providerModel: "openrouter:anthropic/claude-sonnet-4",
      }),
    );
  });

  it("forwards tools to generateText", async () => {
    await runAgent({
      messages: baseMessages,
      system: "You are a helper.",
      tools: baseTools,
    });

    const call = lastGenerateTextCall();
    const tools = call.tools as Record<string, unknown>;
    expect(tools).toBeDefined();
    expect(Object.keys(tools)).toContain("noop");
  });

  it("forwards system and messages to generateText", async () => {
    await runAgent({
      messages: baseMessages,
      system: "You are a helper.",
      tools: baseTools,
    });

    const call = lastGenerateTextCall();
    expect(call.system).toBe("You are a helper.");
    expect(call.messages).toEqual(baseMessages);
  });

  it("passes experimental_telemetry.isEnabled=false when Langfuse keys are absent", async () => {
    await runAgent({
      messages: baseMessages,
      system: "sys",
      tools: baseTools,
    });

    const call = lastGenerateTextCall();
    const telemetry = call.experimental_telemetry as { isEnabled: boolean };
    expect(telemetry.isEnabled).toBe(false);
  });

  it("includes providerModel in telemetry metadata when Langfuse is enabled", async () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-lf-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-lf-test");

    await runAgent({
      messages: baseMessages,
      system: "sys",
      tools: baseTools,
    });

    const call = lastGenerateTextCall();
    const telemetry = call.experimental_telemetry as {
      metadata?: { providerModel?: string };
    };
    expect(telemetry.metadata?.providerModel).toBe(
      "openrouter:anthropic/claude-sonnet-4",
    );
  });

  it("wires executeTool into tools when provided", async () => {
    const executeTool = vi.fn().mockResolvedValue("wired-result");

    await runAgent({
      messages: baseMessages,
      system: "sys",
      tools: baseTools,
      executeTool,
    });

    const call = lastGenerateTextCall();
    const tools = call.tools as Record<string, { execute?: unknown }>;
    const noopTool = tools.noop;
    expect(typeof noopTool?.execute).toBe("function");
  });

  it("returns text, steps, and usage from generateText result", async () => {
    const result = await runAgent({
      messages: baseMessages,
      system: "sys",
      tools: baseTools,
    });

    expect(result.text).toBe("done");
    expect(result.steps).toEqual([]);
    expect(result.usage).toEqual({ totalTokens: 1 });
  });

  it("returns traceMetadata as undefined (v1 — follow-up required for full OTEL capture)", async () => {
    const result = await runAgent({
      messages: baseMessages,
      system: "sys",
      tools: baseTools,
    });

    expect(result.traceMetadata).toBeUndefined();
  });
});
