import { afterEach, describe, expect, it, vi } from "vitest";
import { keys } from "../keys";
import { resolveProviderModel } from "./resolve-provider-model";

function configureEnv(overrides: Record<string, string> = {}): ReturnType<typeof keys> {
  for (const name of [
    "OPENROUTER_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "OLLAMA_BASE_URL",
    "AI_OPENAI_COMPAT_BASE_URL",
    "AI_OPENAI_COMPAT_API_KEY",
  ]) {
    vi.stubEnv(name, "");
  }
  for (const [name, value] of Object.entries(overrides)) {
    vi.stubEnv(name, value);
  }
  return keys();
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveProviderModel()", () => {
  it("resolves a known, configured model to provider + modelId", () => {
    const config = configureEnv({ OPENROUTER_API_KEY: "sk-or-test" });
    expect(
      resolveProviderModel(config, "openrouter:anthropic/claude-sonnet-4"),
    ).toEqual({ provider: "openrouter", modelId: "anthropic/claude-sonnet-4" });
  });

  it("throws on a malformed value", () => {
    const config = configureEnv({ OPENROUTER_API_KEY: "sk-or-test" });
    expect(() => resolveProviderModel(config, "not-a-model")).toThrow();
  });

  it("throws when the model id is not in the catalog", () => {
    const config = configureEnv({ OPENROUTER_API_KEY: "sk-or-test" });
    expect(() =>
      resolveProviderModel(config, "openrouter:made-up-model"),
    ).toThrow(/catalog|unknown/i);
  });

  it("throws when the provider is not configured", () => {
    const config = configureEnv(); // no anthropic key
    expect(() =>
      resolveProviderModel(config, "anthropic:claude-sonnet-4-20250514"),
    ).toThrow(/configured|anthropic/i);
  });

  it("allows ollama without any key (default localhost)", () => {
    const config = configureEnv();
    expect(resolveProviderModel(config, "ollama:llama3.2")).toEqual({
      provider: "ollama",
      modelId: "llama3.2",
    });
  });
});
