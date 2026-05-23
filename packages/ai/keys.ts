import { z } from "zod";

// Transform empty strings to undefined so `AI_PROVIDER=""` is treated as unset.
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

// Treat an empty-string env value as unset for numeric fields. Without this,
// `z.coerce.number()` turns "" into 0 — so a blank `AI_AGENT_MAX_STEPS=` would
// make the agent run 0 steps, and a blank `AI_TEMPERATURE=` would pin it to 0.
const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

const schema = z.object({
  // Provider selection — empty string is treated as unset (same as optionalString)
  AI_PROVIDER: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .enum(["openrouter", "openai", "anthropic", "ollama", "openai-compatible"])
      .optional(),
  ),
  AI_MODEL: optionalString,

  // Generation parameters
  AI_MAX_OUTPUT_TOKENS: z.preprocess(emptyToUndefined, z.coerce.number().optional()),
  AI_TEMPERATURE: z.preprocess(emptyToUndefined, z.coerce.number().optional()),

  // Agent settings
  AI_AGENT_MAX_STEPS: z.preprocess(emptyToUndefined, z.coerce.number().default(5)),

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
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_MODEL: process.env.AI_MODEL,
    AI_MAX_OUTPUT_TOKENS: process.env.AI_MAX_OUTPUT_TOKENS,
    AI_TEMPERATURE: process.env.AI_TEMPERATURE,
    AI_AGENT_MAX_STEPS: process.env.AI_AGENT_MAX_STEPS,
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
