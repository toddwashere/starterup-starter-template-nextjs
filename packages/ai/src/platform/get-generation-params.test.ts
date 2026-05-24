import { describe, expect, it } from "vitest";
import { getGenerationParams } from "./get-generation-params";

describe("getGenerationParams()", () => {
  it("includes temperature and maxOutputTokens when present on the resolved call", () => {
    expect(
      getGenerationParams({
        providerModel: "openrouter:anthropic/claude-sonnet-4",
        maxSteps: 5,
        temperature: 0.7,
        maxOutputTokens: 4096,
      }),
    ).toEqual({ temperature: 0.7, maxOutputTokens: 4096 });
  });

  it("omits fields that are undefined so the SDK uses its own defaults", () => {
    expect(
      getGenerationParams({ providerModel: "ollama:llama3.2", maxSteps: 5 }),
    ).toEqual({});
  });

  it("keeps an explicit temperature of 0", () => {
    const params = getGenerationParams({
      providerModel: "openai:gpt-4o-mini",
      maxSteps: 1,
      temperature: 0,
    });
    expect(params.temperature).toBe(0);
  });
});
