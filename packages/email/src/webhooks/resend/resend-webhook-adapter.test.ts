import { createHmac } from "node:crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";

const WEBHOOK_SECRET = "whsec_" + Buffer.from("super-secret-key-for-tests!!").toString("base64");

vi.mock("../../../keys", () => ({
  keys: vi.fn(),
}));

import { keys } from "../../../keys";
import { resendWebhookAdapter } from "./index";

function signPayload(rawBody: string, svixId = "msg_123", svixTimestamp = "1710000000") {
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const key = Buffer.from("super-secret-key-for-tests!!");
  const signature = createHmac("sha256", key).update(signedContent).digest("base64");
  return {
    "svix-id": svixId,
    "svix-timestamp": svixTimestamp,
    "svix-signature": `v1,${signature}`,
  };
}

describe("resendWebhookAdapter", () => {
  beforeEach(() => {
    vi.mocked(keys).mockReturnValue({
      RESEND_API_KEY: "re_test",
      EMAIL_FROM: "Test <test@example.com>",
      EMAIL_PROVIDER: "resend",
      RESEND_WEBHOOK_SECRET: WEBHOOK_SECRET,
    });
  });

  it("maps delivered, bounced, and complained events", () => {
    const deliveredBody = JSON.stringify({
      type: "email.delivered",
      data: { email_id: "email_1", created_at: "2026-01-01T00:00:00.000Z", to: ["a@x.com"] },
    });
    const bouncedBody = JSON.stringify({
      type: "email.bounced",
      data: {
        email_id: "email_2",
        created_at: "2026-01-01T00:00:00.000Z",
        bounce: { type: "hard" },
      },
    });
    const complainedBody = JSON.stringify({
      type: "email.complained",
      data: { email_id: "email_3", created_at: "2026-01-01T00:00:00.000Z" },
    });

    expect(resendWebhookAdapter.parseEvents(deliveredBody)[0]?.type).toBe("delivered");
    expect(resendWebhookAdapter.parseEvents(bouncedBody)[0]).toMatchObject({
      type: "bounced",
      bounceClass: "hard",
    });
    expect(resendWebhookAdapter.parseEvents(complainedBody)[0]?.type).toBe("complained");
  });

  it("ignores unknown events", () => {
    const body = JSON.stringify({ type: "email.opened", data: { email_id: "email_4" } });
    expect(resendWebhookAdapter.parseEvents(body)).toEqual([]);
  });

  it("verifies Svix signature", () => {
    const rawBody = JSON.stringify({
      type: "email.delivered",
      data: { email_id: "email_1", created_at: "2026-01-01T00:00:00.000Z" },
    });
    const headers = signPayload(rawBody);

    expect(resendWebhookAdapter.verifyRequest(rawBody, headers)).toBe(true);
    expect(
      resendWebhookAdapter.verifyRequest(rawBody, {
        ...headers,
        "svix-signature": "v1,invalid",
      }),
    ).toBe(false);
  });
});
