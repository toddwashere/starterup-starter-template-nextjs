import type Stripe from "stripe";
import { loadPlansForStripePlugin } from "./plans/load-plans-for-stripe-plugin";
import { authorizeOrgBilling } from "./authorize-org-billing";
import {
  handleSubscriptionComplete,
  handleSubscriptionCancel,
  handleSubscriptionUpdate,
  handleSubscriptionDeleted,
} from "./hooks/subscription-lifecycle";
import { onStripeEvent } from "./hooks/on-stripe-event";

/**
 * Builds the options object for the Better Auth Stripe plugin.
 *
 * This package intentionally does NOT import the Stripe plugin package — the
 * plugin is registered in `packages/auth`. We return a plain object with an
 * inferred type; type-compatibility with the plugin's options type is verified
 * at the `packages/auth` call site.
 */
export function stripePluginOptions(stripeClient: Stripe) {
  return {
    stripeClient,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    createCustomerOnSignUp: false,
    organization: { enabled: true as const },
    subscription: {
      enabled: true as const,
      plans: loadPlansForStripePlugin,
      authorizeReference: authorizeOrgBilling,
      requireEmailVerification: true,
      getCheckoutSessionParams: async (data: {
        plan: { name: string };
        subscription: { referenceId: string };
      }) => ({
        params: {
          allow_promotion_codes: true,
          metadata: {
            organizationId: data.subscription.referenceId,
            planName: data.plan.name,
          },
        },
      }),
      onSubscriptionComplete: handleSubscriptionComplete,
      onSubscriptionCreated: handleSubscriptionComplete,
      onSubscriptionCancel: handleSubscriptionCancel,
      onSubscriptionUpdate: handleSubscriptionUpdate,
      onSubscriptionDeleted: handleSubscriptionDeleted,
    },
    onEvent: onStripeEvent,
  };
}
