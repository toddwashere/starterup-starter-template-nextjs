import { createHmac, timingSafeEqual } from "node:crypto";
import { keys } from "../../../keys";
import type { EmailDeliveryEvent, EmailWebhookAdapter } from "../types";

type ResendWebhookPayload = {
  type: string;
  data?: {
    email_id?: string;
    created_at?: string;
    to?: string[];
    bounce?: { type?: string };
  };
};

function decodeSvixSecret(secret: string): Buffer {
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  return Buffer.from(raw, "base64");
}

function verifySvixSignature(
  rawBody: string,
  headers: Record<string, string>,
  secret: string,
): boolean {
  const svixId = headers["svix-id"] ?? headers["Svix-Id"];
  const svixTimestamp = headers["svix-timestamp"] ?? headers["Svix-Timestamp"];
  const svixSignature = headers["svix-signature"] ?? headers["Svix-Signature"];

  if (!svixId || !svixTimestamp || !svixSignature) {
    return false;
  }

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const key = decodeSvixSecret(secret);
  const expected = createHmac("sha256", key).update(signedContent).digest("base64");

  const signatures = svixSignature.split(" ");
  return signatures.some((part) => {
    const [, sig] = part.split(",");
    if (!sig) {
      return false;
    }
    const sigBuffer = Buffer.from(sig);
    const expectedBuffer = Buffer.from(expected);
    return (
      sigBuffer.length === expectedBuffer.length &&
      timingSafeEqual(sigBuffer, expectedBuffer)
    );
  });
}

function mapResendEvent(payload: ResendWebhookPayload): EmailDeliveryEvent | null {
  const providerMessageId = payload.data?.email_id;
  if (!providerMessageId) {
    return null;
  }

  const occurredAt = payload.data?.created_at
    ? new Date(payload.data.created_at)
    : new Date();
  const recipient = payload.data?.to?.[0];

  switch (payload.type) {
    case "email.delivered":
      return {
        type: "delivered",
        provider: "resend",
        providerMessageId,
        occurredAt,
        recipient,
        rawType: payload.type,
      };
    case "email.bounced": {
      const bounceType = payload.data?.bounce?.type?.toLowerCase() ?? "";
      const bounceClass = bounceType.includes("hard") ? "hard" : "soft";
      return {
        type: "bounced",
        provider: "resend",
        providerMessageId,
        occurredAt,
        recipient,
        bounceClass,
        rawType: payload.type,
      };
    }
    case "email.complained":
      return {
        type: "complained",
        provider: "resend",
        providerMessageId,
        occurredAt,
        recipient,
        rawType: payload.type,
      };
    default:
      return null;
  }
}

export const resendWebhookAdapter: EmailWebhookAdapter = {
  verifyRequest(rawBody, headers) {
    const secret = keys().RESEND_WEBHOOK_SECRET;
    if (!secret) {
      return false;
    }
    return verifySvixSignature(rawBody, headers, secret);
  },

  parseEvents(rawBody) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return [];
    }

    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => mapResendEvent(item as ResendWebhookPayload))
        .filter((event): event is EmailDeliveryEvent => event !== null);
    }

    const event = mapResendEvent(parsed as ResendWebhookPayload);
    return event ? [event] : [];
  },
};

export default resendWebhookAdapter;
