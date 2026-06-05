import type { OpenAPIHono } from "@hono/zod-openapi";
import { resendWebhookAdapter } from "@workspace/email/webhooks/resend";
import type { EmailDeliveryEvent } from "@workspace/email/webhooks/types";
import { enqueue } from "@workspace/worker-queue";
import type { AppEnv } from "../../lib/context";

export function registerEmailResendWebhookRoute(app: OpenAPIHono<AppEnv>) {
  app.post("/webhooks/email/resend", async (c) => {
    const rawBody = await c.req.text();
    const headers = Object.fromEntries(c.req.raw.headers.entries());

    if (!resendWebhookAdapter.verifyRequest(rawBody, headers)) {
      return c.text("Invalid signature", 401);
    }

    const events = resendWebhookAdapter.parseEvents(rawBody);
    if (events.length > 0) {
      await enqueue("email.process-delivery-events", {
        provider: "resend",
        events: events.map((event: EmailDeliveryEvent) => ({
          type: event.type,
          providerMessageId: event.providerMessageId,
          occurredAt: event.occurredAt.toISOString(),
          recipient: event.recipient,
          bounceClass: event.bounceClass,
          rawType: event.rawType,
        })),
      });
    }

    return c.text("OK", 200);
  });
}
