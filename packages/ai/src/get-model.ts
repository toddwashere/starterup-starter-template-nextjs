import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { keys } from "../keys";

/**
 * Per-provider default model IDs used when AI_MODEL is not set.
 * Override any of these via the AI_MODEL environment variable.
 */
function getDefaultModelForProvider(
  provider: "openrouter" | "openai" | "anthropic" | "ollama" | "openai-compatible",
): string {
  switch (provider) {
    case "openrouter":
      return "anthropic/claude-sonnet-4"; // Good balance of capability and cost via OpenRouter
    case "openai":
      return "gpt-4o-mini"; // Fast, cheap, capable OpenAI default
    case "anthropic":
      return "claude-sonnet-4-20250514"; // Latest Claude Sonnet via direct Anthropic API
    case "ollama":
      return "llama3"; // Most common local Ollama model
    case "openai-compatible":
      return "local-model"; // Placeholder — the local server defines available models
  }
}

/**
 * Construct and return the configured AI LanguageModel.
 *
 * Reads configuration fresh from environment variables on every call
 * (via keys()) so that vi.stubEnv() works correctly in tests.
 *
 * Throws if the provider is not configured or required API keys are missing.
 * Does NOT make network calls — only constructs provider/model objects.
 */
export function getModel(): LanguageModel {
  const config = keys();

  if (!config.AI_PROVIDER) {
    throw new Error(
      "AI is not configured: set AI_PROVIDER and provider API keys",
    );
  }

  const provider = config.AI_PROVIDER;
  const model = config.AI_MODEL ?? getDefaultModelForProvider(provider);

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
      return openrouterProvider(model);
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
      return openaiProvider.chat(model);
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
      return anthropicProvider(model);
    }

    case "ollama": {
      // Ollama speaks OpenAI-compatible Chat Completions — no real API key needed.
      // Defaults to http://localhost:11434/v1 if OLLAMA_BASE_URL is not set.
      const ollamaProvider = createOpenAI({
        apiKey: "ollama", // Placeholder; Ollama ignores auth
        baseURL: config.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
      });
      return ollamaProvider.chat(model);
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
      return compatProvider.chat(model);
    }
  }
}
