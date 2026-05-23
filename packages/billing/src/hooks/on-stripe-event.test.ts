import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./subscription-lifecycle", () => ({ handleInvoicePaymentFailed: vi.fn() }));

import { handleInvoicePaymentFailed } from "./subscription-lifecycle";
import { onStripeEvent } from "./on-stripe-event";

describe("onStripeEvent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes invoice.payment_failed to handleInvoicePaymentFailed", async () => {
    const event = {
      type: "invoice.payment_failed",
      data: { object: { id: "in_1" } },
    } as never;
    await onStripeEvent(event);
    expect(handleInvoicePaymentFailed).toHaveBeenCalledOnce();
  });

  it("ignores unrelated event types", async () => {
    await onStripeEvent({
      type: "customer.subscription.updated",
      data: { object: {} },
    } as never);
    await onStripeEvent({ type: "invoice.paid", data: { object: {} } } as never);
    expect(handleInvoicePaymentFailed).not.toHaveBeenCalled();
  });
});
