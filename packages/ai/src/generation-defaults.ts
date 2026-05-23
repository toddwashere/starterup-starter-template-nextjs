import { keys } from "../keys";

/**
 * Returns generation parameters sourced from environment variables.
 *
 * Only includes fields that are explicitly set — unset env vars are omitted
 * entirely so the AI SDK uses its own defaults rather than receiving `undefined`.
 *
 * Use the returned object as spread options to generateText / streamText:
 *   const defaults = getGenerationDefaults();
 *   await generateText({ model, ...defaults, messages });
 */
export function getGenerationDefaults(): {
  maxOutputTokens?: number;
  temperature?: number;
} {
  const config = keys();
  const result: { maxOutputTokens?: number; temperature?: number } = {};

  if (config.AI_MAX_OUTPUT_TOKENS !== undefined) {
    result.maxOutputTokens = config.AI_MAX_OUTPUT_TOKENS;
  }

  if (config.AI_TEMPERATURE !== undefined) {
    result.temperature = config.AI_TEMPERATURE;
  }

  return result;
}
