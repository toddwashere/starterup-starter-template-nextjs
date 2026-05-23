import type { ResolvedAiCall } from "./resolve-ai-call-options";

/**
 * Generation parameters to spread into `generateText` / `streamText`.
 *
 * Only includes fields that are set on the resolved call, so unset values fall
 * through to the AI SDK's own defaults rather than being passed as `undefined`.
 * Replaces the old env-sourced `getGenerationDefaults()`.
 */
export function getGenerationParams(resolved: ResolvedAiCall): {
  maxOutputTokens?: number;
  temperature?: number;
} {
  const params: { maxOutputTokens?: number; temperature?: number } = {};

  if (resolved.maxOutputTokens !== undefined) {
    params.maxOutputTokens = resolved.maxOutputTokens;
  }

  if (resolved.temperature !== undefined) {
    params.temperature = resolved.temperature;
  }

  return params;
}
