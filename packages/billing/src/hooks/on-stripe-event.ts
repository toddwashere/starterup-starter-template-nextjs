import type { StripeOptions } from "@better-auth/stripe";
import { handleInvoicePaymentFailed, type StripeInvoiceForBilling } from "./subscription-lifecycle";
import {
  handleCreditTopUpCheckoutCompleted,
  type StripeCheckoutSessionForCreditTopUp,
} from "./credit-top-up-lifecycle";

type StripeWebhookEvent = Parameters<NonNullable<StripeOptions["onEvent"]>>[0];

/**
 * Top-level Stripe webhook event router. The plugin's built-in subscription
 * sync handles the standard subscription/customer events; this hook only adds
 * the extra side effects we care about in v1.
 */
export async function onStripeEvent(event: StripeWebhookEvent): Promise<void> {
  switch (event.type) {
    case "invoice.payment_failed":
      await handleInvoicePaymentFailed(event.data.object as StripeInvoiceForBilling);
      break;
    case "checkout.session.completed":
      await handleCreditTopUpCheckoutCompleted(
        event.data.object as StripeCheckoutSessionForCreditTopUp,
      );
      break;
    default:
      // Other events are handled by the plugin's built-in sync; no extra
      // side effects in v1.
      break;
  }
}
