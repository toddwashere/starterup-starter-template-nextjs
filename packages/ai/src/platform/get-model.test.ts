import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderModelValue } from "./models/ai-models-available";
import { getModel } from "./get-model";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getModel() with an explicit providerModel", () => {
  it("returns a defined model for a configured openrouter model", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");
    expect(
      getModel({ providerModel: "openrouter:anthropic/claude-sonnet-4" }),
    ).toBeDefined();
  });

  it("throws a readable error naming OPENROUTER_API_KEY when it is missing", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(() =>
      getModel({ providerModel: "openrouter:anthropic/claude-sonnet-4" }),
    ).toThrow(/OPENROUTER_API_KEY/);
  });

  it("returns a defined model for a configured openai model", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key");
    expect(getModel({ providerModel: "openai:gpt-4o-mini" })).toBeDefined();
  });

  it("throws a readable error naming OPENAI_API_KEY when it is missing", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(() => getModel({ providerModel: "openai:gpt-4o-mini" })).toThrow(
      /OPENAI_API_KEY/,
    );
  });

  it("returns a defined model for a configured anthropic model", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key");
    expect(
      getModel({ providerModel: "anthropic:claude-sonnet-4-20250514" }),
    ).toBeDefined();
  });

  it("throws a readable error naming ANTHROPIC_API_KEY when it is missing", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(() =>
      getModel({ providerModel: "anthropic:claude-sonnet-4-20250514" }),
    ).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("returns a defined ollama model without requiring OLLAMA_BASE_URL", () => {
    expect(getModel({ providerModel: "ollama:llama3.2" })).toBeDefined();
  });

  it("throws when the providerModel value is malformed", () => {
    expect(() =>
      getModel({ providerModel: "garbage" as ProviderModelValue }),
    ).toThrow(/invalid|provider/i);
  });
});

describe("getModel() with a preset", () => {
  it("builds the assistant preset's model when openrouter is configured", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");
    expect(getModel({ preset: "assistant" })).toBeDefined();
  });

  it("builds the worker preset's model when openai is configured", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key");
    expect(getModel({ preset: "worker" })).toBeDefined();
  });
});
