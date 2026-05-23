import { afterEach, describe, expect, it, vi } from "vitest";
import { keys } from "../keys";
import {
  getAvailableAiModels,
  getDefaultAvailableProviderModel,
} from "./list-available-ai-models";
import { isProviderConfigured } from "./provider-configured";

/**
 * Stub every credential env var to empty, then apply the given overrides, so
 * each test starts from a known "nothing configured" baseline (except Ollama,
 * which is always considered configured via its default localhost URL).
 */
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

describe("isProviderConfigured()", () => {
  it("treats openrouter as configured only when OPENROUTER_API_KEY is non-empty", () => {
    expect(isProviderConfigured(configureEnv(), "openrouter")).toBe(false);
    expect(
      isProviderConfigured(
        configureEnv({ OPENROUTER_API_KEY: "sk-or-test" }),
        "openrouter",
      ),
    ).toBe(true);
  });

  it("treats openai as configured only when OPENAI_API_KEY is non-empty", () => {
    expect(isProviderConfigured(configureEnv(), "openai")).toBe(false);
    expect(
      isProviderConfigured(configureEnv({ OPENAI_API_KEY: "sk-test" }), "openai"),
    ).toBe(true);
  });

  it("treats anthropic as configured only when ANTHROPIC_API_KEY is non-empty", () => {
    expect(isProviderConfigured(configureEnv(), "anthropic")).toBe(false);
    expect(
      isProviderConfigured(
        configureEnv({ ANTHROPIC_API_KEY: "sk-ant-test" }),
        "anthropic",
      ),
    ).toBe(true);
  });

  it("treats ollama as configured even when OLLAMA_BASE_URL is unset (default localhost)", () => {
    expect(isProviderConfigured(configureEnv(), "ollama")).toBe(true);
  });

  it("treats openai-compatible as configured only when AI_OPENAI_COMPAT_BASE_URL is non-empty", () => {
    expect(isProviderConfigured(configureEnv(), "openai-compatible")).toBe(false);
    expect(
      isProviderConfigured(
        configureEnv({ AI_OPENAI_COMPAT_BASE_URL: "http://localhost:1234/v1" }),
        "openai-compatible",
      ),
    ).toBe(true);
  });
});

describe("getAvailableAiModels()", () => {
  it("includes openrouter and excludes unconfigured providers when only OPENROUTER_API_KEY is set", () => {
    const config = configureEnv({ OPENROUTER_API_KEY: "sk-or-test" });
    const values = getAvailableAiModels(config).map((o) => o.value);

    expect(values).toContain("openrouter:anthropic/claude-sonnet-4");
    // anthropic direct and openai are absent without their keys
    expect(values).not.toContain("anthropic:claude-sonnet-4-20250514");
    expect(values).not.toContain("openai:gpt-4o");
    // ollama is always available (default localhost)
    expect(values).toContain("ollama:llama3.2");
  });

  it("includes anthropic models when only ANTHROPIC_API_KEY is set", () => {
    const config = configureEnv({ ANTHROPIC_API_KEY: "sk-ant-test" });
    const values = getAvailableAiModels(config).map((o) => o.value);

    expect(values).toContain("anthropic:claude-sonnet-4-20250514");
    expect(values).not.toContain("openrouter:anthropic/claude-sonnet-4");
  });
});

describe("getDefaultAvailableProviderModel()", () => {
  it("returns the assistant preset model when openrouter is configured", () => {
    const config = configureEnv({ OPENROUTER_API_KEY: "sk-or-test" });
    expect(getDefaultAvailableProviderModel(config)).toBe(
      "openrouter:anthropic/claude-sonnet-4",
    );
  });

  it("falls back to the local (ollama) preset when no API keys are set", () => {
    const config = configureEnv();
    expect(getDefaultAvailableProviderModel(config)).toBe("ollama:llama3.2");
  });

  it("uses the worker preset when only OPENAI_API_KEY makes a preset available before local", () => {
    // assistant (openrouter) unavailable, worker (openai) available → worker wins over local
    const config = configureEnv({ OPENAI_API_KEY: "sk-test" });
    expect(getDefaultAvailableProviderModel(config)).toBe("openai:gpt-4o-mini");
  });
});
