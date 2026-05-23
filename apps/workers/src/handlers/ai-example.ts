import { generateText } from "ai";

import {
  buildTelemetryOptions,
  getGenerationParams,
  getModel,
  logAiCall,
  resolveAiCallOptions,
} from "@workspace/ai";
import { ASSISTANT_SYSTEM_PROMPT } from "@workspace/ai/prompts/assistant-system";

import type { JobHandler } from "../registry";

export const handleAiExample: JobHandler<"ai.example"> = async (payload) => {
  // Background jobs use the "worker" preset (cheap, single-step). Resolve once
  // so the model, generation params, and logging all use the same selection.
  const resolved = resolveAiCallOptions({ preset: "worker" });

  let model;
  try {
    model = getModel({ providerModel: resolved.providerModel });
  } catch (err) {
    // The worker provider isn't configured — skip rather than crash the job.
    console.warn(
      `[workers] ai.example skipped (${resolved.providerModel} unavailable): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return;
  }

  logAiCall({ functionId: "ai.example", providerModel: resolved.providerModel });

  const result = await generateText({
    model,
    system: ASSISTANT_SYSTEM_PROMPT,
    prompt: payload.text,
    ...getGenerationParams(resolved),
    ...buildTelemetryOptions({
      functionId: "ai.example",
      providerModel: resolved.providerModel,
    }),
  });
  console.log(`[workers] ai.example produced ${result.text.length} chars`);
};
