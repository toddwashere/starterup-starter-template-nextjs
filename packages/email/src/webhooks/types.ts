export type EmailDeliveryEventType = "delivered" | "bounced" | "complained";

export interface EmailDeliveryEvent {
  type: EmailDeliveryEventType;
  provider: string;
  providerMessageId: string;
  occurredAt: Date;
  recipient?: string;
  bounceClass?: "hard" | "soft";
  rawType?: string;
}

export interface EmailWebhookAdapter {
  verifyRequest(rawBody: string, headers: Record<string, string>): boolean;
  parseEvents(rawBody: string): EmailDeliveryEvent[];
}
