import { z } from "zod";

// Transform empty strings to undefined so a blank `OPENAI_API_KEY=` is unset.
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

// Secrets only. Model selection and generation params (model id, maxSteps,
// temperature, maxOutputTokens) live in code — see
// packages/ai/src/ai-models-available.ts (AI_CALL_PRESETS) — not in env.
const schema = z.object({
  // OpenRouter
  OPENROUTER_API_KEY: optionalString,
  OPENROUTER_HTTP_REFERER: optionalString,
  OPENROUTER_APP_NAME: optionalString,

  // OpenAI
  OPENAI_API_KEY: optionalString,
  OPENAI_BASE_URL: optionalString,

  // Anthropic
  ANTHROPIC_API_KEY: optionalString,

  // Ollama
  OLLAMA_BASE_URL: optionalString,

  // OpenAI-compatible (e.g. LM Studio, vLLM)
  AI_OPENAI_COMPAT_BASE_URL: optionalString,
  AI_OPENAI_COMPAT_API_KEY: optionalString,

  // Langfuse observability (optional)
  LANGFUSE_PUBLIC_KEY: optionalString,
  LANGFUSE_SECRET_KEY: optionalString,
  LANGFUSE_BASE_URL: optionalString,
});

export function keys() {
  return schema.parse({
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_HTTP_REFERER: process.env.OPENROUTER_HTTP_REFERER,
    OPENROUTER_APP_NAME: process.env.OPENROUTER_APP_NAME,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
    AI_OPENAI_COMPAT_BASE_URL: process.env.AI_OPENAI_COMPAT_BASE_URL,
    AI_OPENAI_COMPAT_API_KEY: process.env.AI_OPENAI_COMPAT_API_KEY,
    LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
    LANGFUSE_BASE_URL: process.env.LANGFUSE_BASE_URL,
  });
}
