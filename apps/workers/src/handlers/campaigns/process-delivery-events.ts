import { processDeliveryEvents } from "@workspace/campaigns";

export async function handleEmailProcessDeliveryEvents(payload: {
  provider: "resend";
  events: Array<{
    type: "delivered" | "bounced" | "complained";
    providerMessageId: string;
    occurredAt: string;
    recipient?: string;
    bounceClass?: "hard" | "soft";
    rawType?: string;
  }>;
}) {
  await processDeliveryEvents(payload.provider, payload.events);
}
