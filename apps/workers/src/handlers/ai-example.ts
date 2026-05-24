import { runWorkerExample } from "@workspace/ai/ai-calls/worker-example";

import type { JobHandler } from "../registry";

export const handleAiExample: JobHandler<"ai.example"> = async (payload) => {
  try {
    const result = await runWorkerExample({
      variables: { inputText: payload.text },
    });
    console.log(`[workers] ai.example produced ${result.text.length} chars`);
  } catch (err) {
    // Skip rather than crash the job when the worker provider isn't configured.
    console.warn(
      `[workers] ai.example skipped: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
};
