import { describe, expect, it } from "vitest";
import {
  AI_CALL_PRESETS,
  AI_MODELS_BY_PROVIDER,
  DEFAULT_PROVIDER_MODEL,
  getAiProviderModelOptions,
  isKnownCatalogModel,
  parseProviderModelValue,
  toProviderModelValue,
} from "./ai-models-available";

describe("parseProviderModelValue()", () => {
  it("parses a provider:modelId value", () => {
    expect(parseProviderModelValue("openrouter:anthropic/claude-sonnet-4")).toEqual({
      provider: "openrouter",
      modelId: "anthropic/claude-sonnet-4",
    });
  });

  it("keeps the full model id when it contains additional colons", () => {
    expect(parseProviderModelValue("ollama:llama3.2:latest")).toEqual({
      provider: "ollama",
      modelId: "llama3.2:latest",
    });
  });

  it("returns null for a string with no colon", () => {
    expect(parseProviderModelValue("gpt-4o")).toBeNull();
  });

  it("returns null for an unknown provider prefix", () => {
    expect(parseProviderModelValue("acme:some-model")).toBeNull();
  });

  it("returns null for an empty model id", () => {
    expect(parseProviderModelValue("openai:")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseProviderModelValue("")).toBeNull();
  });
});

describe("toProviderModelValue()", () => {
  it("joins provider and model id with a colon", () => {
    expect(toProviderModelValue("anthropic", "claude-sonnet-4-20250514")).toBe(
      "anthropic:claude-sonnet-4-20250514",
    );
  });

  it("round-trips with parseProviderModelValue", () => {
    const value = toProviderModelValue("openai", "gpt-4o-mini");
    expect(parseProviderModelValue(value)).toEqual({
      provider: "openai",
      modelId: "gpt-4o-mini",
    });
  });
});

describe("isKnownCatalogModel()", () => {
  it("returns true for a model present in the catalog", () => {
    expect(isKnownCatalogModel("openrouter", "anthropic/claude-sonnet-4")).toBe(
      true,
    );
  });

  it("returns false for a model id not in the provider's list", () => {
    expect(isKnownCatalogModel("openai", "not-a-real-model")).toBe(false);
  });

  it("returns false for an unknown provider", () => {
    expect(
      isKnownCatalogModel(
        "acme" as Parameters<typeof isKnownCatalogModel>[0],
        "anything",
      ),
    ).toBe(false);
  });
});

describe("getAiProviderModelOptions()", () => {
  it("returns one option per catalog model with value, label, and groupLabel", () => {
    const options = getAiProviderModelOptions();

    const total = Object.values(AI_MODELS_BY_PROVIDER).reduce(
      (sum, models) => sum + models.length,
      0,
    );
    expect(options).toHaveLength(total);

    const openrouterOption = options.find(
      (o) => o.value === "openrouter:anthropic/claude-sonnet-4",
    );
    expect(openrouterOption).toBeDefined();
    expect(openrouterOption?.label).toBe("Claude Sonnet 4 (OpenRouter)");
    expect(openrouterOption?.groupLabel).toBe("OpenRouter");
  });

  it("produces values that parse back to a known catalog model", () => {
    for (const option of getAiProviderModelOptions()) {
      const parsed = parseProviderModelValue(option.value);
      expect(parsed).not.toBeNull();
      expect(isKnownCatalogModel(parsed!.provider, parsed!.modelId)).toBe(true);
    }
  });
});

describe("AI_CALL_PRESETS", () => {
  it("exposes assistant, worker, and local presets", () => {
    expect(Object.keys(AI_CALL_PRESETS)).toEqual(
      expect.arrayContaining(["assistant", "worker", "local"]),
    );
  });

  it("every preset references a known catalog model", () => {
    for (const preset of Object.values(AI_CALL_PRESETS)) {
      const parsed = parseProviderModelValue(preset.providerModel);
      expect(parsed).not.toBeNull();
      expect(isKnownCatalogModel(parsed!.provider, parsed!.modelId)).toBe(true);
    }
  });

  it("DEFAULT_PROVIDER_MODEL matches the assistant preset model", () => {
    expect(DEFAULT_PROVIDER_MODEL).toBe(AI_CALL_PRESETS.assistant.providerModel);
  });
});
