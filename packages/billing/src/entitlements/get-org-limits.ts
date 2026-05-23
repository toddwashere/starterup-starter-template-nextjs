import { getActiveSubscriptionForOrg } from "../data-models/subscription-repo";
import { getBillingPlanByName } from "../data-models/billing-plan-repo";
import type { OrgLimits } from "./types";

// Safety net: the seeded `free` BillingPlan is the source of truth for free-tier limits.
// This constant is only used when the database has no `free` plan record at all.
const FREE_FALLBACK_LIMITS: OrgLimits = { contacts: 50 };

export async function getOrgLimits(orgId: string): Promise<OrgLimits> {
  const sub = await getActiveSubscriptionForOrg(orgId);
  const planName = sub?.plan ?? "free";

  const plan = await getBillingPlanByName(planName);

  if (plan) {
    return plan.limits as OrgLimits;
  }

  // Plan not found in database — fall back to the free plan if we weren't already on it.
  if (planName !== "free") {
    const freePlan = await getBillingPlanByName("free");
    if (freePlan) {
      return freePlan.limits as OrgLimits;
    }
  }

  return FREE_FALLBACK_LIMITS;
}
