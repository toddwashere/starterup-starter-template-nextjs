import { listActiveBillingPlans } from "../data-models/billing-plan-repo";
import { toStripePluginPlan } from "./to-stripe-plugin-plan";

export async function loadPlansForStripePlugin() {
  const rows = await listActiveBillingPlans();
  return rows.filter((p) => p.name !== "free").map(toStripePluginPlan);
}
