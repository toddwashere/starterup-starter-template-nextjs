import { createId } from "@workspace/common";
import { prisma } from "@workspace/database";
import { creditsConfig } from "../../credits.config";
import { CreditConfigurationError } from "../errors";
import { grantCredits } from "./usage-service";

type TopUpProduct = (typeof creditsConfig.topUpProducts)[number];

export function listCreditTopUpProducts() {
  return creditsConfig.topUpProducts
    .filter((product) => product.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((product) => ({
      name: product.name,
      displayName: product.displayName,
      credits: product.credits,
      stripePriceIdEnvVar: product.stripePriceIdEnvVar,
      isActive: product.isActive,
      sortOrder: product.sortOrder,
    }));
}

export function resolveCreditTopUpProduct(name: string): TopUpProduct {
  const product = creditsConfig.topUpProducts.find(
    (candidate) => candidate.name === name && candidate.isActive,
  );
  if (!product) {
    throw new CreditConfigurationError(`Unknown credit top-up product: ${name}`);
  }
  return product;
}

export async function grantStripeTopUp(input: {
  organizationId: string;
  topUpProductName: string;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId?: string | null;
  stripeAmountPaidInCents?: number | null;
}) {
  const product = resolveCreditTopUpProduct(input.topUpProductName);

  await prisma.creditTopUpPurchase.upsert({
    where: {
      stripeCheckoutSessionId: input.stripeCheckoutSessionId,
    },
    update: {
      organizationId: input.organizationId,
      topUpProductName: input.topUpProductName,
      credits: product.credits,
      stripePaymentIntentId: input.stripePaymentIntentId ?? null,
      stripeAmountPaidInCents: input.stripeAmountPaidInCents ?? null,
      status: "paid",
    },
    create: {
      id: createId("credtopup"),
      organizationId: input.organizationId,
      topUpProductName: input.topUpProductName,
      credits: product.credits,
      stripeCheckoutSessionId: input.stripeCheckoutSessionId,
      stripePaymentIntentId: input.stripePaymentIntentId ?? null,
      stripeAmountPaidInCents: input.stripeAmountPaidInCents ?? null,
      status: "paid",
    },
  });

  const event = await grantCredits({
    organizationId: input.organizationId,
    amountCredits: product.credits,
    bucket: "wallet",
    source: "stripe",
    usageArea: "stripe_top_up",
    idempotencyKey: `stripe_top_up:${input.stripeCheckoutSessionId}`,
    metadata: {
      topUpProductName: input.topUpProductName,
      stripeCheckoutSessionId: input.stripeCheckoutSessionId,
      stripePaymentIntentId: input.stripePaymentIntentId ?? null,
      stripeAmountPaidInCents: input.stripeAmountPaidInCents ?? null,
    },
  });

  await prisma.creditTopUpPurchase.update({
    where: {
      stripeCheckoutSessionId: input.stripeCheckoutSessionId,
    },
    data: {
      status: "fulfilled",
      fulfilledAt: new Date(),
    },
  });

  return event;
}
