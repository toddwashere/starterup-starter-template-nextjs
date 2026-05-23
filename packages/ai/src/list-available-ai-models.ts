import type { keys } from "../keys";
import {
  AI_CALL_PRESETS,
  getAiProviderModelOptions,
  parseProviderModelValue,
  type AiCallPresetName,
  type ProviderModelValue,
} from "./ai-models-available";
import { isProviderConfigured } from "./provider-configured";

export { isProviderConfigured };

type ProviderModelOption = ReturnType<typeof getAiProviderModelOptions>[number];

/**
 * Catalog options filtered to providers that have credentials configured.
 *
 * Server-only: pass `keys()`. Never trust a client to pre-filter — the chat
 * route revalidates with `resolveProviderModel` before constructing a model.
 */
export function getAvailableAiModels(
  config: ReturnType<typeof keys>,
): ProviderModelOption[] {
  return getAiProviderModelOptions().filter((option) => {
    const parsed = parseProviderModelValue(option.value);
    return parsed !== null && isProviderConfigured(config, parsed.provider);
  });
}

/** Preset preference order for picking a sensible default selection. */
const PRESET_PREFERENCE: AiCallPresetName[] = ["assistant", "worker", "local"];

/**
 * The default model to preselect in the UI: the first preset (in preference
 * order) whose provider is configured, else the first available catalog model,
 * else `null` when nothing is available.
 */
export function getDefaultAvailableProviderModel(
  config: ReturnType<typeof keys>,
): ProviderModelValue | null {
  const available = getAvailableAiModels(config);
  const availableValues = new Set(available.map((o) => o.value));

  for (const presetName of PRESET_PREFERENCE) {
    const candidate = AI_CALL_PRESETS[presetName].providerModel;
    if (availableValues.has(candidate)) {
      return candidate;
    }
  }

  return available[0]?.value ?? null;
}
