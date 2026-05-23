import type { JobHandler } from "../registry";

export const handleWebhookDeliver: JobHandler<"webhook.deliver"> = async (
  payload,
) => {
  // Stub: real outbound webhook delivery is future work.
  console.log(
    `[workers] webhook.deliver: would deliver ${payload.deliveryId} (stub)`,
  );
};
