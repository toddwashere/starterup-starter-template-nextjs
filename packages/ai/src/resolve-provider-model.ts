import type { keys } from "../keys";
import {
  isKnownCatalogModel,
  parseProviderModelValue,
  PROVIDER_LABELS,
  type AiProviderId,
} from "./ai-models-available";
import { isProviderConfigured } from "./provider-configured";

/**
 * Validate and resolve a `provider:modelId` value against the catalog and the
 * configured credentials. Throws a readable error when the value is malformed,
 * not in the catalog, or its provider has no credentials configured.
 *
 * Server-only and authoritative: the chat route MUST call this before
 * `getModel()` so a client cannot request an unknown or unconfigured model.
 */
export function resolveProviderModel(
  config: ReturnType<typeof keys>,
  value: string,
): { provider: AiProviderId; modelId: string } {
  const parsed = parseProviderModelValue(value);
  if (!parsed) {
    throw new Error(
      `Invalid model value "${value}". Expected the form "provider:modelId".`,
    );
  }

  if (!isKnownCatalogModel(parsed.provider, parsed.modelId)) {
    throw new Error(
      `Unknown model "${value}" — not present in the AI catalog (ai-models-available.ts).`,
    );
  }

  if (!isProviderConfigured(config, parsed.provider)) {
    throw new Error(
      `Provider "${PROVIDER_LABELS[parsed.provider]}" is not configured. Set its API key or base URL in .env, then restart.`,
    );
  }

  return parsed;
}
