import { generateText } from "ai";

import {
  buildTelemetryOptions,
  getGenerationDefaults,
  getModel,
} from "@workspace/ai";
import { ASSISTANT_SYSTEM_PROMPT } from "@workspace/ai/prompts/assistant-system";

import type { JobHandler } from "../registry";

export const handleAiExample: JobHandler<"ai.example"> = async (payload) => {
  const result = await generateText({
    model: getModel(),
    system: ASSISTANT_SYSTEM_PROMPT,
    prompt: payload.text,
    ...getGenerationDefaults(),
    ...buildTelemetryOptions({ functionId: "ai.example" }),
  });
  console.log(`[workers] ai.example produced ${result.text.length} chars`);
};
