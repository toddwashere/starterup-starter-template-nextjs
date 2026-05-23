import { describe, expect, it } from "vitest";
import { AI_CALL_PRESETS } from "./models/ai-models-available";
import { resolveAiCallOptions } from "./resolve-ai-call-options";

describe("resolveAiCallOptions()", () => {
  it("returns the named preset verbatim when no overrides are given", () => {
    expect(resolveAiCallOptions({ preset: "assistant" })).toEqual({
      providerModel: "openrouter:anthropic/claude-sonnet-4",
      maxSteps: 5,
      temperature: 0.7,
      maxOutputTokens: 4096,
    });
  });

  it("overrides the providerModel while keeping the preset's generation params", () => {
    const resolved = resolveAiCallOptions({
      preset: "assistant",
      overrides: { providerModel: "anthropic:claude-sonnet-4-20250514" },
    });

    expect(resolved.providerModel).toBe("anthropic:claude-sonnet-4-20250514");
    expect(resolved.maxSteps).toBe(AI_CALL_PRESETS.assistant.maxSteps);
    expect(resolved.temperature).toBe(AI_CALL_PRESETS.assistant.temperature);
    expect(resolved.maxOutputTokens).toBe(AI_CALL_PRESETS.assistant.maxOutputTokens);
  });

  it("merges scalar overrides over the preset", () => {
    const resolved = resolveAiCallOptions({
      preset: "worker",
      overrides: { temperature: 0.9 },
    });

    expect(resolved.temperature).toBe(0.9);
    expect(resolved.providerModel).toBe("openai:gpt-4o-mini");
    expect(resolved.maxSteps).toBe(1);
  });

  it("ignores undefined override values rather than clobbering preset values", () => {
    const resolved = resolveAiCallOptions({
      preset: "assistant",
      overrides: { providerModel: undefined },
    });

    expect(resolved.providerModel).toBe("openrouter:anthropic/claude-sonnet-4");
  });

  it("accepts an explicit full call config", () => {
    const resolved = resolveAiCallOptions({
      providerModel: "ollama:llama3.2",
      maxSteps: 3,
    });

    expect(resolved).toEqual({ providerModel: "ollama:llama3.2", maxSteps: 3 });
  });
});
