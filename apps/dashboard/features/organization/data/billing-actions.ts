"use server";

import { headers } from "next/headers";
import { auth } from "@workspace/auth";
import { listActiveBillingPlans } from "@workspace/billing";

/**
 * A plan exposed to the client for the upgrade UI. Intentionally minimal:
 * the upgrade call only needs `name` (plan) and `annual`, so Stripe price IDs
 * are never sent to the browser.
 */
export interface PublicBillingPlan {
  name: string;
  displayName: string;
  hasAnnual: boolean;
  limits: Record<string, number>;
}

function normalizeLimits(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      out[key] = raw;
    }
  }
  return out;
}

/**
 * Determine whether the current session user may manage billing for the given
 * organization. Uses a NON-throwing permission check so members get a
 * read-only view rather than an error.
 */
export async function getBillingContextForOrg(
  organizationId: string,
): Promise<{ canManage: boolean }> {
  try {
    const result = await auth.api.hasPermission({
      headers: await headers(),
      body: {
        organizationId,
        permissions: { billing: ["manage"] },
      },
    });
    return { canManage: result?.success === true };
  } catch {
    return { canManage: false };
  }
}

/**
 * Return the active billing plan catalog for the billing UI, stripping all
 * secret/Stripe-specific fields. Includes the `free` plan so the page can show
 * the current Free plan's limits; the upgrade dialog filters `free` out of the
 * selectable checkout options.
 */
export async function listPublicBillingPlans(): Promise<PublicBillingPlan[]> {
  const plans = await listActiveBillingPlans();
  return plans.map((plan) => ({
    name: plan.name,
    displayName: plan.displayName,
    hasAnnual: Boolean(plan.stripePriceIdAnnual),
    limits: normalizeLimits(plan.limits),
  }));
}
