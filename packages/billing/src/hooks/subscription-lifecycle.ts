import type { StripeOptions } from "@better-auth/stripe";
import { prisma } from "@workspace/database";
import { formatDate, parseOrgRoles } from "@workspace/common";
import {
  sendSubscriptionWelcomeEmail,
  sendSubscriptionCanceledEmail,
  sendPaymentFailedEmail,
} from "@workspace/email";
import { getBillingPlanByName } from "../data-models/billing-plan-repo";

interface OrgBillingContact {
  recipient: string;
  organizationName: string;
}

type StripeWebhookEvent = Parameters<NonNullable<StripeOptions["onEvent"]>>[0];
type StripeInvoicePaymentFailedEvent = Extract<
  StripeWebhookEvent,
  { type: "invoice.payment_failed" }
>;
export type StripeInvoiceForBilling =
  StripeInvoicePaymentFailedEvent["data"]["object"];

/**
 * Resolve the email recipient (org owner) and org name for billing
 * notifications, given an organization id.
 */
export async function resolveOrgBillingContactByOrgId(
  orgId: string,
): Promise<OrgBillingContact | null> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true },
  });
  // Members can hold multiple roles stored as a CSV (e.g. "owner,member"), so an
  // exact role === "owner" match would miss multi-role owners. Narrow at the DB
  // with a substring filter, then confirm with parseOrgRoles.
  const owners = await prisma.member.findMany({
    where: { organizationId: orgId, role: { contains: "owner" } },
    select: { role: true, user: { select: { email: true } } },
  });
  const owner = owners.find((m) => parseOrgRoles(m.role).includes("owner"));

  const recipient = owner?.user?.email;
  if (!org || !recipient) {
    return null;
  }

  return { recipient, organizationName: org.name };
}

/**
 * Resolve the billing contact for an organization by its Stripe customer id.
 */
export async function resolveOrgBillingContactByCustomerId(
  stripeCustomerId: string,
): Promise<OrgBillingContact | null> {
  const org = await prisma.organization.findFirst({
    where: { stripeCustomerId },
    select: { id: true },
  });
  if (!org) {
    return null;
  }
  return resolveOrgBillingContactByOrgId(org.id);
}

/**
 * Map an internal plan name to its human-readable display name, falling back
 * to the raw name if the plan can't be found.
 */
export async function planDisplayName(planName: string): Promise<string> {
  const plan = await getBillingPlanByName(planName);
  return plan?.displayName ?? planName;
}

/**
 * Subscription has been completed/created — send the welcome email.
 * Used for both onSubscriptionComplete and onSubscriptionCreated.
 */
export async function handleSubscriptionComplete(data: {
  subscription: { referenceId: string; plan: string };
}): Promise<void> {
  try {
    const { subscription } = data;
    const contact = await resolveOrgBillingContactByOrgId(
      subscription.referenceId,
    );
    if (!contact) {
      return;
    }
    await sendSubscriptionWelcomeEmail({
      recipient: contact.recipient,
      organizationName: contact.organizationName,
      planName: await planDisplayName(subscription.plan),
    });
  } catch (error) {
    console.error("[billing] handleSubscriptionComplete failed", error);
  }
}

/**
 * Subscription has been canceled — notify the org owner.
 */
export async function handleSubscriptionCancel(data: {
  subscription: {
    referenceId: string;
    plan: string;
    periodEnd?: Date | null;
  };
}): Promise<void> {
  try {
    const { subscription } = data;
    const contact = await resolveOrgBillingContactByOrgId(
      subscription.referenceId,
    );
    if (!contact) {
      return;
    }
    await sendSubscriptionCanceledEmail({
      recipient: contact.recipient,
      organizationName: contact.organizationName,
      planName: await planDisplayName(subscription.plan),
      accessEndsAt: subscription.periodEnd
        ? formatDate(subscription.periodEnd)
        : undefined,
    });
  } catch (error) {
    console.error("[billing] handleSubscriptionCancel failed", error);
  }
}

/**
 * Subscription updated — v1 minimal: log a concise line. No email.
 */
export async function handleSubscriptionUpdate(data: {
  subscription: { referenceId: string; status: string };
}): Promise<void> {
  try {
    const { subscription } = data;
    console.log(
      `[billing] subscription updated for org ${subscription.referenceId}: status=${subscription.status}`,
    );
  } catch (error) {
    console.error("[billing] handleSubscriptionUpdate failed", error);
  }
}

/**
 * Subscription deleted — v1 minimal: log a concise line. Entitlements
 * naturally fall back to free, so no further action is needed.
 */
export async function handleSubscriptionDeleted(data: {
  subscription: { referenceId: string };
}): Promise<void> {
  try {
    const { subscription } = data;
    console.log(
      `[billing] subscription deleted for org ${subscription.referenceId}; falling back to free entitlements`,
    );
  } catch (error) {
    console.error("[billing] handleSubscriptionDeleted failed", error);
  }
}

/**
 * Invoice payment failed — notify the org owner with a link to update payment.
 */
export async function handleInvoicePaymentFailed(
  invoice: StripeInvoiceForBilling,
): Promise<void> {
  try {
    const customerId =
      typeof invoice.customer === "string"
        ? invoice.customer
        : invoice.customer?.id;
    if (!customerId) {
      return;
    }
    const contact = await resolveOrgBillingContactByCustomerId(customerId);
    if (!contact) {
      return;
    }
    await sendPaymentFailedEmail({
      recipient: contact.recipient,
      organizationName: contact.organizationName,
      updatePaymentUrl: invoice.hosted_invoice_url ?? undefined,
    });
  } catch (error) {
    console.error("[billing] handleInvoicePaymentFailed failed", error);
  }
}
