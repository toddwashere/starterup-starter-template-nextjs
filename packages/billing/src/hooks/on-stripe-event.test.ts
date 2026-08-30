import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./subscription-lifecycle", () => ({ handleInvoicePaymentFailed: vi.fn() }));
vi.mock("./credit-top-up-lifecycle", () => ({
  handleCreditTopUpCheckoutCompleted: vi.fn(),
}));

import { handleInvoicePaymentFailed } from "./subscription-lifecycle";
import { handleCreditTopUpCheckoutCompleted } from "./credit-top-up-lifecycle";
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

  it("routes checkout.session.completed to handleCreditTopUpCheckoutCompleted", async () => {
    const session = { id: "cs_1", metadata: { kind: "credit_top_up" } };
    const event = {
      type: "checkout.session.completed",
      data: { object: session },
    } as never;
    await onStripeEvent(event);
    expect(handleCreditTopUpCheckoutCompleted).toHaveBeenCalledWith(session);
  });

  it("ignores unrelated event types", async () => {
    await onStripeEvent({
      type: "customer.subscription.updated",
      data: { object: {} },
    } as never);
    await onStripeEvent({ type: "invoice.paid", data: { object: {} } } as never);
    expect(handleInvoicePaymentFailed).not.toHaveBeenCalled();
    expect(handleCreditTopUpCheckoutCompleted).not.toHaveBeenCalled();
  });
});
