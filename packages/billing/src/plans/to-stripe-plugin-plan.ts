export interface StripePluginPlan {
  name: string;
  priceId?: string;
  lookupKey?: string;
  annualDiscountPriceId?: string;
  limits?: Record<string, number>;
  freeTrial?: { days: number };
  group?: string;
  seatPriceId?: string;
}

/** Subset of BillingPlan fields read by this mapper. */
interface BillingPlanRow {
  name: string;
  stripePriceIdMonthly: string;
  stripePriceIdAnnual: string | null;
  stripeLookupKeyMonthly: string | null;
  limits: unknown;
  freeTrialDays: number | null;
  seatPriceId: string | null;
  group: string | null;
}

export function toStripePluginPlan(row: BillingPlanRow): StripePluginPlan {
  const plan: StripePluginPlan = {
    name: row.name,
  };

  if (row.stripePriceIdMonthly) {
    plan.priceId = row.stripePriceIdMonthly;
  }

  if (row.stripeLookupKeyMonthly) {
    plan.lookupKey = row.stripeLookupKeyMonthly;
  }

  if (row.stripePriceIdAnnual) {
    plan.annualDiscountPriceId = row.stripePriceIdAnnual;
  }

  if (row.limits != null) {
    plan.limits = row.limits as Record<string, number>;
  }

  if (typeof row.freeTrialDays === "number") {
    plan.freeTrial = { days: row.freeTrialDays };
  }

  if (row.group) {
    plan.group = row.group;
  }

  if (row.seatPriceId) {
    plan.seatPriceId = row.seatPriceId;
  }

  return plan;
}
