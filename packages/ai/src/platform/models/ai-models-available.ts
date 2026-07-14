/**
 * Central AI model catalog.
 *
 * This module is the single source of truth for which models the monorepo
 * supports. It is **client-safe**: it contains only constants and pure
 * functions — no `keys()`/env reads, no provider SDK imports. Runtime
 * availability (filtering by configured API keys) lives in the server-only
 * `list-available-ai-models.ts`.
 *
 * Models are encoded as `provider:modelId` strings, e.g.
 * `"openrouter:anthropic/claude-sonnet-4"` or `"anthropic:claude-sonnet-4-20250514"`.
 */

export type AiProviderId =
  | "openrouter"
  | "openai"
  | "anthropic"
  | "bedrock"
  | "ollama"
  | "openai-compatible";

export interface AiModelOption {
  /** Provider-specific model id (the part after the `provider:` prefix). */
  id: string;
  /** Human-readable label shown in the selector. */
  label: string;
}

export const PROVIDER_LABELS: Record<AiProviderId, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  bedrock: "Amazon Bedrock",
  ollama: "Ollama",
  "openai-compatible": "OpenAI-compatible",
};

export const OPENROUTER_MODELS: AiModelOption[] = [
  { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4 (OpenRouter)" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o mini (OpenRouter)" },
];

export const OPENAI_MODELS: AiModelOption[] = [
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4o-mini", label: "GPT-4o mini" },
];

export const ANTHROPIC_MODELS: AiModelOption[] = [
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
];

// Bedrock model ids embed a colon version suffix (e.g. `...-v1:0`). Because
// `parseProviderModelValue` splits on the first colon only, the `bedrock:`
// prefix parses correctly and the version suffix is preserved in the model id.
export const BEDROCK_MODELS: AiModelOption[] = [
  {
    id: "anthropic.claude-sonnet-5",
    label: "Claude Sonnet 5 (Bedrock)",
  },
  {
    id: "anthropic.claude-3-haiku-20240307-v1:0",
    label: "Claude 3 Haiku (Bedrock)",
  },
];

export const OLLAMA_MODELS: AiModelOption[] = [
  { id: "llama3.2", label: "Llama 3.2" },
];

export const OPENAI_COMPAT_MODELS: AiModelOption[] = [
  { id: "local-model", label: "Local model" },
];

/** All models grouped by provider — the full allowlist, not filtered by env. */
export const AI_MODELS_BY_PROVIDER: Record<AiProviderId, AiModelOption[]> = {
  openrouter: OPENROUTER_MODELS,
  openai: OPENAI_MODELS,
  anthropic: ANTHROPIC_MODELS,
  bedrock: BEDROCK_MODELS,
  ollama: OLLAMA_MODELS,
  "openai-compatible": OPENAI_COMPAT_MODELS,
};

/** Stable provider ordering for the catalog and the selector dropdown. */
const PROVIDER_ORDER: AiProviderId[] = [
  "openrouter",
  "openai",
  "anthropic",
  "bedrock",
  "ollama",
  "openai-compatible",
];

export type ProviderModelValue = `${AiProviderId}:${string}`;

function isAiProviderId(value: string): value is AiProviderId {
  return Object.prototype.hasOwnProperty.call(PROVIDER_LABELS, value);
}

/**
 * Parse a `provider:modelId` value.
 *
 * Splits on the first colon only, so model ids that themselves contain colons
 * (e.g. `ollama:llama3.2:latest`) are preserved. Returns `null` when the value
 * is malformed, the provider prefix is unknown, or the model id is empty.
 */
export function parseProviderModelValue(
  value: string,
): { provider: AiProviderId; modelId: string } | null {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0) return null;

  const provider = value.slice(0, separatorIndex);
  const modelId = value.slice(separatorIndex + 1);

  if (!modelId) return null;
  if (!isAiProviderId(provider)) return null;

  return { provider, modelId };
}

/** Build a canonical `provider:modelId` value. */
export function toProviderModelValue(
  provider: AiProviderId,
  modelId: string,
): ProviderModelValue {
  return `${provider}:${modelId}`;
}

/** True when `modelId` is listed under `provider` in the catalog. */
export function isKnownCatalogModel(
  provider: AiProviderId,
  modelId: string,
): boolean {
  const models = AI_MODELS_BY_PROVIDER[provider];
  if (!models) return false;
  return models.some((m) => m.id === modelId);
}

/**
 * Flatten the catalog into selector options: one entry per model, carrying the
 * canonical value, the model label, and its provider group label.
 */
export function getAiProviderModelOptions(): {
  value: ProviderModelValue;
  label: string;
  groupLabel: string;
}[] {
  return PROVIDER_ORDER.flatMap((provider) =>
    AI_MODELS_BY_PROVIDER[provider].map((model) => ({
      value: toProviderModelValue(provider, model.id),
      label: model.label,
      groupLabel: PROVIDER_LABELS[provider],
    })),
  );
}

export interface AiCallPreset {
  providerModel: ProviderModelValue;
  maxSteps: number;
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * Named call presets — the code-level defaults for model + generation params.
 * These intentionally replace the old `AI_*` generation env vars.
 */
export const AI_CALL_PRESETS = {
  assistant: {
    providerModel: "openrouter:anthropic/claude-sonnet-4",
    maxSteps: 5,
    temperature: 0.7,
    maxOutputTokens: 4096,
  },
  worker: {
    providerModel: "openai:gpt-4o-mini",
    maxSteps: 1,
    temperature: 0,
    maxOutputTokens: 1024,
  },
  local: {
    providerModel: "ollama:llama3.2",
    maxSteps: 5,
    temperature: 0.7,
  },
} as const satisfies Record<string, AiCallPreset>;

export type AiCallPresetName = keyof typeof AI_CALL_PRESETS;

/** The model used when a caller provides no explicit selection. */
export const DEFAULT_PROVIDER_MODEL: ProviderModelValue =
  AI_CALL_PRESETS.assistant.providerModel;
