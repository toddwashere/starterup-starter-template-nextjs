import { keys } from "../keys";

export interface TelemetryContext {
  functionId: string;
  userId?: string;
  orgId?: string;
  sessionId?: string;
  langfuseTraceId?: string;
}

export interface TelemetryOptions {
  experimental_telemetry: {
    isEnabled: boolean;
    functionId?: string;
    metadata?: Record<string, string>;
  };
}

/**
 * Builds the `experimental_telemetry` option for AI SDK calls.
 *
 * Returns a no-op (isEnabled: false) when Langfuse keys are not configured,
 * which is the safe default in local development. When both keys are present,
 * telemetry is enabled and context fields are forwarded as metadata.
 *
 * NOTE: This helper only produces the AI SDK option object. The actual OTEL
 * span processor / Langfuse exporter must be registered separately by the
 * host application (e.g. via `LangfuseExporter` from `langfuse-vercel`).
 * This package has no dependency on @langfuse/* packages.
 */
export function buildTelemetryOptions(ctx: TelemetryContext): TelemetryOptions {
  const config = keys();

  if (!config.LANGFUSE_PUBLIC_KEY || !config.LANGFUSE_SECRET_KEY) {
    return { experimental_telemetry: { isEnabled: false } };
  }

  const metadata: Record<string, string> = {};

  if (ctx.userId !== undefined) {
    metadata.userId = ctx.userId;
  }

  if (ctx.orgId !== undefined) {
    metadata.orgId = ctx.orgId;
  }

  if (ctx.sessionId !== undefined) {
    metadata.sessionId = ctx.sessionId;
  }

  if (ctx.langfuseTraceId !== undefined) {
    metadata.langfuseTraceId = ctx.langfuseTraceId;
  }

  return {
    experimental_telemetry: {
      isEnabled: true,
      functionId: ctx.functionId,
      metadata,
    },
  };
}
