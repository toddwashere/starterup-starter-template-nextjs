import { describe, expect, it, vi, beforeEach } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createHmac } from "node:crypto";
import type { AppEnv } from "../../lib/context";

vi.mock("@workspace/email/webhooks/resend", () => ({
  resendWebhookAdapter: {
    verifyRequest: vi.fn(),
    parseEvents: vi.fn(),
  },
}));

vi.mock("@workspace/worker-queue", () => ({
  enqueue: vi.fn(),
}));

import { resendWebhookAdapter } from "@workspace/email/webhooks/resend";
import { enqueue } from "@workspace/worker-queue";
import { registerEmailResendWebhookRoute } from "./email-resend";

function buildApp() {
  const app = new OpenAPIHono<AppEnv>();
  registerEmailResendWebhookRoute(app);
  return app;
}

describe("POST /webhooks/email/resend", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when signature is invalid", async () => {
    vi.mocked(resendWebhookAdapter.verifyRequest).mockReturnValue(false);

    const res = await buildApp().request("/webhooks/email/resend", {
      method: "POST",
      body: "{}",
    });

    expect(res.status).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("enqueues delivery events and returns 200", async () => {
    vi.mocked(resendWebhookAdapter.verifyRequest).mockReturnValue(true);
    vi.mocked(resendWebhookAdapter.parseEvents).mockReturnValue([
      {
        type: "delivered",
        provider: "resend",
        providerMessageId: "email_1",
        occurredAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    const res = await buildApp().request("/webhooks/email/resend", {
      method: "POST",
      body: JSON.stringify({ type: "email.delivered" }),
      headers: {
        "content-type": "application/json",
        "svix-id": "msg_1",
        "svix-timestamp": "1710000000",
        "svix-signature": `v1,${createHmac("sha256", Buffer.from("super-secret-key-for-tests!!")).update("x").digest("base64")}`,
      },
    });

    expect(res.status).toBe(200);
    expect(enqueue).toHaveBeenCalledWith("email.process-delivery-events", {
      provider: "resend",
      events: [
        expect.objectContaining({
          type: "delivered",
          providerMessageId: "email_1",
        }),
      ],
    });
  });
});
