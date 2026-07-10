import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { awsCredentialsProvider } from "@vercel/functions/oidc";
import type { LanguageModel } from "ai";
import { keys } from "../../keys";
import {
  AI_CALL_PRESETS,
  parseProviderModelValue,
  type AiCallPresetName,
  type ProviderModelValue,
} from "./models/ai-models-available";

export type GetModelInput =
  | { providerModel: ProviderModelValue }
  | { preset: AiCallPresetName };

/**
 * Construct the AI LanguageModel for a `provider:modelId` selection or a preset.
 *
 * Reads configuration fresh from environment variables on every call (via
 * `keys()`) so `vi.stubEnv()` works in tests. Throws a readable error if the
 * value is malformed or the chosen provider's credentials are missing. Does NOT
 * make network calls — only constructs provider/model objects.
 *
 * Catalog membership and credential policy are validated authoritatively by
 * `resolveProviderModel` (called by the chat route before this). Presets always
 * reference catalog models, so `getModel` only needs the per-provider key
 * checks below.
 */
export function getModel(input: GetModelInput): LanguageModel {
  const config = keys();

  const providerModel: ProviderModelValue =
    "preset" in input
      ? AI_CALL_PRESETS[input.preset].providerModel
      : input.providerModel;

  const parsed = parseProviderModelValue(providerModel);
  if (!parsed) {
    throw new Error(
      `Invalid providerModel "${providerModel}". Expected the form "provider:modelId".`,
    );
  }

  const { provider, modelId } = parsed;

  switch (provider) {
    case "openrouter": {
      if (!config.OPENROUTER_API_KEY) {
        throw new Error(
          "AI provider 'openrouter' requires OPENROUTER_API_KEY to be set",
        );
      }
      // OpenRouterProviderSettings accepts appUrl (sets HTTP-Referer header) and appName
      // (sets X-OpenRouter-Title header) for app attribution on the openrouter.ai dashboard.
      // Note: the env var is OPENROUTER_HTTP_REFERER but the SDK field is appUrl.
      const openrouterProvider = createOpenRouter({
        apiKey: config.OPENROUTER_API_KEY,
        ...(config.OPENROUTER_HTTP_REFERER
          ? { appUrl: config.OPENROUTER_HTTP_REFERER }
          : {}),
        ...(config.OPENROUTER_APP_NAME
          ? { appName: config.OPENROUTER_APP_NAME }
          : {}),
      });
      return openrouterProvider(modelId);
    }

    case "openai": {
      if (!config.OPENAI_API_KEY) {
        throw new Error(
          "AI provider 'openai' requires OPENAI_API_KEY to be set",
        );
      }
      // Use .chat() so OpenAI-compatible Chat Completions API is always used,
      // which also works with custom baseURL proxy servers.
      const openaiProvider = createOpenAI({
        apiKey: config.OPENAI_API_KEY,
        ...(config.OPENAI_BASE_URL ? { baseURL: config.OPENAI_BASE_URL } : {}),
      });
      return openaiProvider.chat(modelId);
    }

    case "anthropic": {
      if (!config.ANTHROPIC_API_KEY) {
        throw new Error(
          "AI provider 'anthropic' requires ANTHROPIC_API_KEY to be set",
        );
      }
      const anthropicProvider = createAnthropic({
        apiKey: config.ANTHROPIC_API_KEY,
      });
      return anthropicProvider(modelId);
    }

    case "bedrock": {
      if (!config.AWS_REGION) {
        throw new Error(
          "AI provider 'bedrock' requires AWS_REGION to be set",
        );
      }
      // On Vercel, AWS_ROLE_ARN drives OIDC-federated (keyless) credentials.
      // In AWS (App Runner / Lambda) AWS_ROLE_ARN is unset and the standard
      // credential chain resolves the task/instance role. Neither path makes a
      // network call here — credentials are fetched lazily on first invocation.
      const credentialProvider = config.AWS_ROLE_ARN
        ? awsCredentialsProvider({ roleArn: config.AWS_ROLE_ARN })
        : fromNodeProviderChain();
      const bedrock = createAmazonBedrock({
        region: config.AWS_REGION,
        credentialProvider,
      });
      return bedrock(modelId);
    }

    case "ollama": {
      // Ollama speaks OpenAI-compatible Chat Completions — no real API key needed.
      // Defaults to http://localhost:11434/v1 if OLLAMA_BASE_URL is not set.
      const ollamaProvider = createOpenAI({
        apiKey: "ollama", // Placeholder; Ollama ignores auth
        baseURL: config.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
      });
      return ollamaProvider.chat(modelId);
    }

    case "openai-compatible": {
      if (!config.AI_OPENAI_COMPAT_BASE_URL) {
        throw new Error(
          "AI provider 'openai-compatible' requires AI_OPENAI_COMPAT_BASE_URL to be set",
        );
      }
      // Works with LM Studio, vLLM, text-generation-webui, etc.
      const compatProvider = createOpenAI({
        apiKey: config.AI_OPENAI_COMPAT_API_KEY ?? "",
        baseURL: config.AI_OPENAI_COMPAT_BASE_URL,
      });
      return compatProvider.chat(modelId);
    }
  }
}
