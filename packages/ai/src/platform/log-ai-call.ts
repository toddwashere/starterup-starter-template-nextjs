export interface AiCallLogEvent {
  /** Logical call site, e.g. "ai.chat" or "ai.example". */
  functionId: string;
  /** Canonical model string, e.g. "openrouter:anthropic/claude-sonnet-4". */
  providerModel: string;
  userId?: string;
  orgId?: string;
}

/**
 * Record the model string used for an AI call as a structured console line.
 *
 * This is the lightweight v1 audit trail — every call site logs the canonical
 * `providerModel` after resolving it. (Langfuse metadata and chat message
 * metadata carry the same string when those features are enabled.)
 *
 * `JSON.stringify` drops `undefined` fields, so optional context is omitted
 * cleanly when not provided.
 */
export function logAiCall(event: AiCallLogEvent): void {
  console.info("[ai]", JSON.stringify(event));
}
