import { generateText, stepCountIs, streamText } from "ai";
import type { ModelMessage, ToolSet } from "ai";
import { keys } from "../../keys";
import { loadCallPrompt, type DefinedAiCall } from "./define-ai-call";
import { getGenerationParams } from "./get-generation-params";
import { getModel } from "./get-model";
import { logAiCall } from "./log-ai-call";
import type { ProviderModelValue } from "./models/ai-models-available";
import { renderPrompt } from "./render-prompt";
import { resolveAiCallOptions } from "./resolve-ai-call-options";
import { resolveProviderModel } from "./resolve-provider-model";
import { buildTelemetryOptions } from "./telemetry";

export interface AskAiInput {
  /** Conversation history for `stream`/`agent` modes. */
  messages?: ModelMessage[];
  /** User prompt for `generate` mode. */
  prompt?: string;
  tools?: ToolSet;
  /** Plain variables for the call's prompt — validated by the call's Zod schema. */
  variables: Record<string, unknown>;
  /** Per-request model override (e.g. the dashboard model selector). */
  overrides?: { providerModel?: ProviderModelValue };
  context?: { userId?: string; orgId?: string; sessionId?: string };
  /** Stream-mode finish callback (e.g. persist the assistant message). */
  onFinish?: (event: { text: string; steps: unknown[]; usage?: unknown }) => void | Promise<void>;
}

/**
 * The single entry point for every LLM invocation. Validates variables, resolves
 * the model + generation params from the call's preset (+ overrides), renders the
 * prompt, logs the call, and dispatches to the AI SDK by the call's mode. Apps
 * never call `streamText`/`generateText` directly — they call a named command
 * (e.g. `askAssistantChat`) which delegates here.
 */
export async function askAi(call: DefinedAiCall, input: AskAiInput) {
  const config = keys();

  // 1. Validate variables against the call's contract.
  const variables = call.variables.parse(input.variables);

  // 2. Resolve preset + call overrides + per-request override.
  const resolved = resolveAiCallOptions({
    preset: call.preset,
    overrides: { ...call.presetOverrides, ...(input.overrides ?? {}) },
  });

  // Authoritative validation when the caller picked a model (catalog + keys).
  if (input.overrides?.providerModel) {
    resolveProviderModel(config, resolved.providerModel);
  }

  // 3. Render the system prompt from prompt.md.
  const system = renderPrompt(loadCallPrompt(call), variables);

  // 4. Record the canonical model used.
  logAiCall({
    functionId: call.id,
    providerModel: resolved.providerModel,
    userId: input.context?.userId,
    orgId: input.context?.orgId,
  });

  const model = getModel({ providerModel: resolved.providerModel });
  const telemetry = buildTelemetryOptions({
    functionId: call.id,
    providerModel: resolved.providerModel,
    userId: input.context?.userId,
    orgId: input.context?.orgId,
    sessionId: input.context?.sessionId,
  });
  const generation = getGenerationParams(resolved);

  // 5. Dispatch by mode.
  if (call.mode === "generate") {
    if (input.prompt === undefined) {
      throw new Error(`Call "${call.id}" is generate mode and requires a prompt.`);
    }
    return generateText({
      model,
      system,
      prompt: input.prompt,
      ...(input.tools ? { tools: input.tools } : {}),
      stopWhen: stepCountIs(resolved.maxSteps),
      ...generation,
      ...telemetry,
    });
  }

  // "stream" (and "agent", which streams a multi-step tool loop) share the same
  // streamText path; the step cap from the preset bounds the agent loop.
  return streamText({
    model,
    system,
    messages: input.messages ?? [],
    ...(input.tools ? { tools: input.tools } : {}),
    stopWhen: stepCountIs(resolved.maxSteps),
    ...generation,
    ...telemetry,
    ...(input.onFinish ? { onFinish: input.onFinish } : {}),
  });
}
