import { describe, expect, it } from "vitest";
import { normalizeModelUsage } from "./normalization";

describe("normalizeModelUsage", () => {
  it("converts provider usage into integer marked-up credits", () => {
    const result = normalizeModelUsage({
      providerModel: "openai:gpt-4o-mini",
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cachedInputTokens: 10,
        reasoningTokens: 5,
      },
    });

    expect(result).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 10,
      reasoningTokens: 5,
      normalizedTokens: 340,
      creditsCharged: 425,
      pricingVersion: "2026-08-29",
      markupBasisPoints: 12_500,
    });
  });

  it("allows local models to be configured as zero credit cost", () => {
    const result = normalizeModelUsage({
      providerModel: "ollama:llama3.2",
      usage: { inputTokens: 500, outputTokens: 250 },
    });

    expect(result.creditsCharged).toBe(0);
    expect(result.normalizedTokens).toBe(0);
  });
});
