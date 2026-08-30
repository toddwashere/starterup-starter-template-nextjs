"use server";

import { headers } from "next/headers";
import { auth } from "@workspace/auth";
import {
  getOrgCreditBalance,
  listCreditActivity,
  listCreditTopUpProducts,
} from "@workspace/credits";
import { getStripeClient } from "@workspace/billing/stripe-client";
import { dashboardConfig } from "../../../dashboard.config";

export async function getCreditOverviewForOrg(organizationId: string) {
  if (!dashboardConfig.features.credits.showInBilling) {
    return null;
  }

  const [balance, activity] = await Promise.all([
    getOrgCreditBalance(organizationId),
    listCreditActivity({ organizationId, limit: 10 }),
  ]);

  return {
    balance: {
      monthlyAllowanceBalanceCredits: balance.monthlyAllowanceBalanceCredits,
      walletBalanceCredits: balance.walletBalanceCredits,
      overdraftCredits: balance.overdraftCredits,
      totalBalanceCredits: balance.totalBalanceCredits,
      currentPeriodStart: balance.currentPeriodStart,
      currentPeriodEnd: balance.currentPeriodEnd,
    },
    activity: activity.map((event) => ({
      id: event.id,
      status: event.status,
      source: event.source,
      usageArea: event.usageArea,
      creditsCharged: event.creditsCharged,
      createdAt: event.createdAt,
      ledgerEntries: event.ledgerEntries.map((entry) => ({
        effect: entry.effect,
        bucket: entry.bucket,
        amountCredits: entry.amountCredits,
      })),
    })),
  };
}

export async function listPublicCreditTopUpProducts() {
  if (!dashboardConfig.features.credits.showInBilling) {
    return [];
  }

  return listCreditTopUpProducts().map((product) => ({
    name: product.name,
    displayName: product.displayName,
    credits: product.credits,
  }));
}

export async function createCreditTopUpCheckoutAction(input: {
  organizationId: string;
  orgSlug: string;
  productName: string;
  returnUrl: string;
}) {
  const result = await auth.api.hasPermission({
    headers: await headers(),
    body: {
      organizationId: input.organizationId,
      permissions: { billing: ["manage"] },
    },
  });

  if (result?.success !== true) {
    throw new Error("You do not have permission to manage billing.");
  }

  const product = listCreditTopUpProducts().find(
    (candidate) => candidate.name === input.productName,
  );
  if (!product) {
    throw new Error("Credit top-up product is not available.");
  }

  const stripePriceId = process.env[product.stripePriceIdEnvVar];
  if (!stripePriceId) {
    throw new Error(`Missing Stripe price id env var: ${product.stripePriceIdEnvVar}`);
  }

  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: stripePriceId, quantity: 1 }],
    success_url: input.returnUrl,
    cancel_url: input.returnUrl,
    metadata: {
      kind: "credit_top_up",
      organizationId: input.organizationId,
      topUpProductName: product.name,
      credits: String(product.credits),
    },
  });

  return { url: session.url };
}
