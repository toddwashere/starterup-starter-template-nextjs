import { generateText, stepCountIs } from "ai";
import type {
  GenerateTextOnStepFinishCallback,
  ModelMessage,
  Tool,
  ToolSet,
} from "ai";
import { keys } from "../keys";
import { getGenerationDefaults } from "./generation-defaults";
import { getModel } from "./get-model";
import { buildTelemetryOptions } from "./telemetry";

export type AgentTool = Tool;

export type ExecuteToolFn = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export interface RunAgentInput {
  messages: ModelMessage[];
  system: string;
  tools: ToolSet;
  executeTool?: ExecuteToolFn;
  maxSteps?: number;
  telemetry?: {
    functionId?: string;
    userId?: string;
    orgId?: string;
    sessionId?: string;
  };
  onStepFinish?: GenerateTextOnStepFinishCallback<ToolSet>;
}

export interface RunAgentResult {
  text: string;
  steps: unknown;
  usage: unknown;
  traceMetadata?: { langfuseTraceId?: string };
}

/**
 * Returns a new ToolSet where every tool keeps its `description` and
 * `inputSchema`, but has its `execute` replaced with a call to `executeTool`.
 *
 * The tool's record key (its name) is forwarded as the first argument so the
 * executor can dispatch to the correct handler.
 *
 * This is a pure function — easy to unit-test without mocking the AI SDK.
 */
export function wireToolExecution(
  tools: ToolSet,
  executeTool: ExecuteToolFn,
): ToolSet {
  const wired: ToolSet = {};

  for (const [toolName, toolDef] of Object.entries(tools)) {
    wired[toolName] = {
      ...toolDef,
      execute: (args: unknown) =>
        executeTool(toolName, args as Record<string, unknown>),
    } as ToolSet[string];
  }

  return wired;
}

/**
 * Run a multi-step AI agent with a configurable step cap.
 *
 * - Picks up model and generation defaults from environment variables.
 * - When `executeTool` is provided, wires it into every tool in the ToolSet.
 * - Sends telemetry metadata when Langfuse keys are configured; no-ops otherwise.
 * - `traceMetadata.langfuseTraceId` is undefined in v1 — full OTEL trace-id
 *   capture is a documented follow-up.
 */
export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const k = keys();

  const tools = input.executeTool
    ? wireToolExecution(input.tools, input.executeTool)
    : input.tools;

  const result = await generateText({
    model: getModel(),
    system: input.system,
    messages: input.messages,
    tools,
    stopWhen: stepCountIs(input.maxSteps ?? k.AI_AGENT_MAX_STEPS),
    onStepFinish: input.onStepFinish,
    ...getGenerationDefaults(),
    ...buildTelemetryOptions({
      functionId: input.telemetry?.functionId ?? "run-agent",
      userId: input.telemetry?.userId,
      orgId: input.telemetry?.orgId,
      sessionId: input.telemetry?.sessionId,
    }),
  });

  return {
    text: result.text,
    steps: result.steps,
    usage: result.usage,
    traceMetadata: undefined,
  };
}
