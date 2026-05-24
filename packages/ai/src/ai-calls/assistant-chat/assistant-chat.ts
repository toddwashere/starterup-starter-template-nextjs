import type { ModelMessage, ToolSet, streamText } from "ai";
import { z } from "zod";
import { askAi, type AskAiInput } from "../../platform/ask-ai";
import { defineAiCall } from "../../platform/define-ai-call";
import type { ProviderModelValue } from "../../platform/models/ai-models-available";

/** Prompt variable contract — must match the placeholders in prompt.md. */
export const variables = z.object({
  orgName: z.string().min(1),
  toolSummary: z.string().optional(),
});

export const call = defineAiCall({
  id: "assistant-chat",
  importMetaUrl: import.meta.url,
  prompt: "./prompt.md",
  preset: "assistant",
  mode: "stream",
  variables,
});

export interface AskAssistantChatInput {
  messages: ModelMessage[];
  tools: ToolSet;
  variables: z.infer<typeof variables>;
  /** Per-request model selection from the dashboard UI. */
  overrides?: { providerModel?: ProviderModelValue };
  context: { userId: string; orgId: string; sessionId?: string };
  onFinish?: AskAiInput["onFinish"];
}

/**
 * Public command for the dashboard AI Assistant. Streams a tool-capable
 * response using the assistant prompt + preset; the caller supplies the
 * variables (org name, tool summary) and an optional model override.
 */
export async function askAssistantChat(
  input: AskAssistantChatInput,
): Promise<ReturnType<typeof streamText>> {
  return askAi(call, input) as Promise<ReturnType<typeof streamText>>;
}
