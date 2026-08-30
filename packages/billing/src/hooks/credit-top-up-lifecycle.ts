import { grantStripeTopUp } from "@workspace/credits";

export type StripeCheckoutSessionForCreditTopUp = {
  id: string;
  payment_intent?: string | { id?: string } | null;
  amount_total?: number | null;
  metadata?: Record<string, string | undefined> | null;
};

function paymentIntentId(paymentIntent: StripeCheckoutSessionForCreditTopUp["payment_intent"]) {
  if (!paymentIntent) return null;
  if (typeof paymentIntent === "string") return paymentIntent;
  return paymentIntent.id ?? null;
}

export async function handleCreditTopUpCheckoutCompleted(
  session: StripeCheckoutSessionForCreditTopUp,
) {
  if (session.metadata?.kind !== "credit_top_up") return null;

  const organizationId = session.metadata.organizationId;
  const topUpProductName = session.metadata.topUpProductName;
  if (!organizationId || !topUpProductName) {
    throw new Error("Credit top-up checkout session is missing metadata.");
  }

  return grantStripeTopUp({
    organizationId,
    topUpProductName,
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId: paymentIntentId(session.payment_intent),
    stripeAmountPaidInCents: session.amount_total ?? null,
  });
}
