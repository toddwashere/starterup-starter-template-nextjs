import {
  AI_CALL_PRESETS,
  type AiCallPreset,
  type AiCallPresetName,
  type ProviderModelValue,
} from "./ai-models-available";

/**
 * Either a named preset (optionally with overrides) or an explicit full call
 * config. Chat passes `{ preset: "assistant", overrides: { providerModel } }`;
 * workers pass `{ preset: "worker" }`.
 */
export type AiCallOptions =
  | { preset: AiCallPresetName; overrides?: Partial<AiCallPreset> }
  | AiCallPreset;

/** A fully-resolved call config. `providerModel` is the canonical log string. */
export type ResolvedAiCall = AiCallPreset & {
  providerModel: ProviderModelValue;
};

/**
 * Resolve call options into a concrete config by merging a preset with any
 * overrides. This is a pure value transform — it does NOT check API keys or
 * the catalog (use `resolveProviderModel` for that before constructing a model).
 *
 * Undefined override values are ignored so a `{ providerModel: undefined }`
 * (e.g. an unset UI selection) never clobbers the preset's model.
 */
export function resolveAiCallOptions(options: AiCallOptions): ResolvedAiCall {
  if ("preset" in options) {
    const merged: Record<string, unknown> = { ...AI_CALL_PRESETS[options.preset] };

    if (options.overrides) {
      for (const [key, value] of Object.entries(options.overrides)) {
        if (value !== undefined) {
          merged[key] = value;
        }
      }
    }

    return merged as unknown as ResolvedAiCall;
  }

  return { ...options };
}
