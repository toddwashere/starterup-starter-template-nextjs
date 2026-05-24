export { getModel } from "./platform/get-model";
export type { GetModelInput } from "./platform/get-model";
export { getGenerationParams } from "./platform/get-generation-params";
export { resolveAiCallOptions } from "./platform/resolve-ai-call-options";
export type {
  AiCallOptions,
  ResolvedAiCall,
} from "./platform/resolve-ai-call-options";
export { logAiCall } from "./platform/log-ai-call";
export type { AiCallLogEvent } from "./platform/log-ai-call";
export { buildTelemetryOptions } from "./platform/telemetry";
export type { TelemetryContext, TelemetryOptions } from "./platform/telemetry";
export { runAgent, wireToolExecution } from "./platform/run-agent";
export type {
  AgentTool,
  ExecuteToolFn,
  RunAgentInput,
  RunAgentResult,
} from "./platform/run-agent";

// Platform building blocks for defining new calls
export { askAi } from "./platform/ask-ai";
export type { AskAiInput } from "./platform/ask-ai";
export { defineAiCall, loadCallPrompt } from "./platform/define-ai-call";
export type { AiCallMode, DefinedAiCall } from "./platform/define-ai-call";
export { renderPrompt } from "./platform/render-prompt";
export { extractTemplateVars } from "./platform/extract-template-vars";

// Named AI calls registry
export * from "./ai-calls";
