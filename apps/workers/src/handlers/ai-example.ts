import { runWorkerExample } from "@workspace/ai/ai-calls/worker-example";
import { AI_CALL_PRESETS } from "@workspace/ai/ai-models-available";
import { beginCreditUsage, creditsConfig, type AiUsageLike } from "@workspace/credits";

import type { JobHandler } from "../registry";

export const handleAiExample: JobHandler<"ai.example"> = async (payload) => {
  const shouldCharge = payload.chargeToOrg ?? creditsConfig.policy.chargeToOrgDefault;
  const creditUsage = payload.organizationId
    ? await beginCreditUsage({
        organizationId: payload.organizationId,
        usageArea: "worker_ai_call",
        source: "worker",
        actor: payload.userId ? { kind: "user", userId: payload.userId } : { kind: "system" },
        chargeToOrg: shouldCharge,
        idempotencyKey: `worker:ai.example:${payload.organizationId}:${payload.text}`,
        metadata: { event: "ai.example" },
      })
    : null;

  try {
    const result = await runWorkerExample({
      variables: { inputText: payload.text },
      context: {
        userId: payload.userId,
        orgId: payload.organizationId,
      },
    });
    await creditUsage?.settleModelUsage({
      providerModel: AI_CALL_PRESETS.worker.providerModel,
      usage: result.usage as AiUsageLike | undefined,
      metadata: { event: "ai.example" },
    });
    console.log(`[workers] ai.example produced ${result.text.length} chars`);
  } catch (err) {
    await creditUsage?.markFailedWithoutCharge({
      metadata: {
        event: "ai.example",
        error: err instanceof Error ? err.message : String(err),
      },
    });
    // Skip rather than crash the job when the worker provider isn't configured.
    console.warn(
      `[workers] ai.example skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
};
