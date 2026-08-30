import type { PrismaClient } from "../../src/generated/prisma/client";

/**
 * Required catalog data for all environments.
 * Replace placeholder price IDs with real Stripe test-mode price IDs,
 * or set STRIPE_PRICE_* env vars, before Checkout will work.
 */
export async function seedBillingPlans(prisma: PrismaClient) {
  const billingPlans = [
    {
      id: "bplan_free",
      name: "free",
      displayName: "Free",
      stripePriceIdMonthly: "",
      stripePriceIdAnnual: null,
      limits: { contacts: 50 },
      creditPolicy: {
        monthlyAllowanceCredits: 10_000,
        monthlyCreditCap: 10_000,
      },
      freeTrialDays: null,
      isActive: true,
      sortOrder: 0,
    },
    {
      id: "bplan_pro",
      name: "pro",
      displayName: "Pro",
      stripePriceIdMonthly: process.env.STRIPE_PRICE_PRO_MONTHLY ?? "price_pro_monthly_placeholder",
      stripePriceIdAnnual: process.env.STRIPE_PRICE_PRO_ANNUAL ?? null,
      limits: { contacts: 1000 },
      creditPolicy: {
        monthlyAllowanceCredits: 100_000,
        monthlyCreditCap: 150_000,
      },
      freeTrialDays: 14,
      isActive: true,
      sortOrder: 1,
    },
    {
      id: "bplan_team",
      name: "team",
      displayName: "Team",
      stripePriceIdMonthly:
        process.env.STRIPE_PRICE_TEAM_MONTHLY ?? "price_team_monthly_placeholder",
      stripePriceIdAnnual: null,
      limits: { contacts: 5000, seats: 10 },
      creditPolicy: {
        monthlyAllowanceCredits: 500_000,
        monthlyCreditCap: 750_000,
      },
      freeTrialDays: null,
      isActive: true,
      sortOrder: 2,
    },
  ];

  for (const plan of billingPlans) {
    const { id, name, ...rest } = plan;
    await prisma.billingPlan.upsert({
      where: { name },
      update: rest,
      create: { id, name, ...rest },
    });
    console.log(`Upserted billing plan: ${name}`);
  }
}
