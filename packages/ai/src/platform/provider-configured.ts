import type { keys } from "../../keys";
import type { AiProviderId } from "./models/ai-models-available";

/**
 * Whether a provider has the credentials/config it needs to be usable.
 *
 * Server-only: takes a parsed `keys()` config. This is the single gate used by
 * both runtime availability (the selector) and server-side validation
 * (`resolveProviderModel`), so the UI and the API can never disagree.
 *
 * Ollama is always considered configured because it speaks an OpenAI-compatible
 * API at a default localhost URL — no API key required. A misconfigured/offline
 * Ollama surfaces as a runtime request error, not a catalog filter.
 */
export function isProviderConfigured(
  config: ReturnType<typeof keys>,
  provider: AiProviderId,
): boolean {
  switch (provider) {
    case "openrouter":
      return Boolean(config.OPENROUTER_API_KEY);
    case "openai":
      return Boolean(config.OPENAI_API_KEY);
    case "anthropic":
      return Boolean(config.ANTHROPIC_API_KEY);
    case "bedrock":
      // IAM-based: usable whenever a region is resolvable. Credentials come from
      // the AWS chain (task role) or Vercel OIDC (AWS_ROLE_ARN) at call time.
      return Boolean(config.AWS_REGION);
    case "ollama":
      return true;
    case "openai-compatible":
      return Boolean(config.AI_OPENAI_COMPAT_BASE_URL);
  }
}
