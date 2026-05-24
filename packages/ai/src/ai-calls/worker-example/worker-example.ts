import type { generateText } from "ai";
import { z } from "zod";
import { askAi } from "../../platform/ask-ai";
import { defineAiCall } from "../../platform/define-ai-call";
import type { ProviderModelValue } from "../../platform/models/ai-models-available";

/**
 * Worker prompt variable contract. `inputText` is the text to act on — it is
 * passed to the model as the generate-mode user prompt (the prompt.md system is
 * static), so it is validated here rather than templated into prompt.md.
 */
export const variables = z.object({
  inputText: z.string().min(1),
});

export const call = defineAiCall({
  id: "worker-example",
  importMetaUrl: import.meta.url,
  prompt: "./prompt.md",
  preset: "worker",
  mode: "generate",
  variables,
});

export interface RunWorkerExampleInput {
  variables: z.infer<typeof variables>;
  overrides?: { providerModel?: ProviderModelValue };
  context?: { userId?: string; orgId?: string; sessionId?: string };
}

/**
 * Public command for the example background job: generate text from `inputText`
 * using the cheap, single-step "worker" preset.
 */
export async function runWorkerExample(
  input: RunWorkerExampleInput,
): Promise<Awaited<ReturnType<typeof generateText>>> {
  return askAi(call, {
    variables: input.variables,
    prompt: input.variables.inputText,
    overrides: input.overrides,
    context: input.context,
  }) as Promise<Awaited<ReturnType<typeof generateText>>>;
}
