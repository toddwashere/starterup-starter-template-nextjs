"use client";

import { useState } from "react";
import NiceModal from "@ebay/nice-modal-react";
import { useQuery } from "@tanstack/react-query";
import { authClient } from "@workspace/auth/client";
import { formatDate } from "@workspace/common";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Page, PageBody } from "@workspace/ui/components/page";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { toast } from "@workspace/ui/components/sonner";
import {
  IconForBilling,
  IconForVerified,
  IconForWarning,
} from "@workspace/ui/components/icon-for";
import { PageHeaderInOrg } from "@/common/ui/page-header-in-org";
import {
  getBillingContextForOrg,
  listPublicBillingPlans,
  type PublicBillingPlan,
} from "../data/billing-actions";
import { BillingUpgradeDialog } from "./billing-upgrade-dialog";
import { formatLimitLabel } from "./billing-format";
import { useCurrentOrg } from "./org-provider";

type ListSubscriptionsResult = Awaited<
  ReturnType<typeof authClient.subscription.list>
>;
type ActiveSubscription = ListSubscriptionsResult extends (infer T)[]
  ? T
  : never;

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

function statusBadgeVariant(
  status: string,
): "default" | "secondary" | "outline" {
  if (status === "active") return "default";
  if (status === "trialing") return "secondary";
  return "outline";
}

function LimitsList({ limits }: { limits: Record<string, unknown> }) {
  const entries = Object.entries(limits).filter(
    ([, value]) => typeof value === "number",
  ) as [string, number][];
  if (entries.length === 0) return null;
  return (
    <div className="grid gap-1">
      <span className="text-sm font-medium text-muted-foreground">
        Plan limits
      </span>
      <ul className="text-sm">
        {entries.map(([key, value]) => (
          <li key={key}>
            {formatLimitLabel(key)}: {value.toLocaleString()}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BillingPageContent() {
  const { organization, isLoading: orgLoading } = useCurrentOrg();
  const orgId = organization?.id;
  const orgSlug = organization?.slug;
  const [actionPending, setActionPending] = useState<
    "portal" | "cancel" | "restore" | null
  >(null);

  const { data: context, isLoading: contextLoading } = useQuery({
    queryKey: ["billing-context", orgId],
    queryFn: () => getBillingContextForOrg(orgId!),
    enabled: !!orgId,
  });

  const {
    data: subscriptions,
    isLoading: subsLoading,
    refetch: refetchSubs,
  } = useQuery({
    queryKey: ["billing-subscriptions", orgId],
    queryFn: async (): Promise<ActiveSubscription[]> => {
      const result = await authClient.subscription.list({
        query: { referenceId: orgId!, customerType: "organization" },
      });
      return Array.isArray(result) ? result : [];
    },
    enabled: !!orgId,
  });

  const { data: plans, isLoading: plansLoading } = useQuery({
    queryKey: ["billing-plans"],
    queryFn: () => listPublicBillingPlans(),
  });

  const canManage = context?.canManage ?? false;
  const activeSub =
    subscriptions?.find((sub) => ACTIVE_STATUSES.has(sub.status)) ?? null;

  const planList: PublicBillingPlan[] = plans ?? [];
  const planDisplayName = (planName: string) =>
    planList.find((p) => p.name === planName)?.displayName ?? planName;

  const showSkeleton =
    orgLoading ||
    !organization ||
    contextLoading ||
    subsLoading ||
    plansLoading;

  const billingReturnUrl = () =>
    `${window.location.origin}/${orgSlug}/settings/billing`;

  const openUpgradeDialog = (subscriptionId?: string) => {
    if (!orgId || !orgSlug) return;
    void NiceModal.show(BillingUpgradeDialog, {
      referenceId: orgId,
      orgSlug,
      subscriptionId,
      plans: planList,
    });
  };

  const handleManageBilling = async () => {
    if (!orgId) return;
    setActionPending("portal");
    try {
      const result = await authClient.subscription.billingPortal({
        referenceId: orgId,
        customerType: "organization",
        returnUrl: billingReturnUrl(),
      });
      const url = (result as { url?: string })?.url;
      if (url) {
        window.location.href = url;
        return;
      }
      toast.error("Unable to open the billing portal.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to open billing portal",
      );
    } finally {
      setActionPending(null);
    }
  };

  const handleCancel = async () => {
    if (!orgId || !activeSub?.stripeSubscriptionId) return;
    setActionPending("cancel");
    try {
      await authClient.subscription.cancel({
        subscriptionId: activeSub.stripeSubscriptionId,
        referenceId: orgId,
        customerType: "organization",
        returnUrl: billingReturnUrl(),
      });
      await refetchSubs();
      toast.success("Subscription set to cancel at the end of the period.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to cancel subscription",
      );
    } finally {
      setActionPending(null);
    }
  };

  const handleRestore = async () => {
    if (!orgId || !activeSub?.stripeSubscriptionId) return;
    setActionPending("restore");
    try {
      await authClient.subscription.restore({
        subscriptionId: activeSub.stripeSubscriptionId,
        referenceId: orgId,
        customerType: "organization",
      });
      await refetchSubs();
      toast.success("Subscription restored.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to restore subscription",
      );
    } finally {
      setActionPending(null);
    }
  };

  const freePlan = planList.find((p) => p.name === "free");

  return (
    <Page className="flex min-h-0 flex-1 flex-col">
      <PageHeaderInOrg
        title="Billing"
        description="Manage your organization's billing and subscription."
      />
      <PageBody disableScroll className="space-y-6 p-6">
        {showSkeleton ? (
          <Skeleton className="h-64 w-full" />
        ) : !activeSub ? (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <IconForBilling className="text-muted-foreground" />
                <CardTitle>Current plan: Free</CardTitle>
              </div>
              <CardDescription>
                You are on the Free plan. Upgrade to unlock higher limits and
                additional features.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {freePlan && <LimitsList limits={freePlan.limits} />}
            </CardContent>
            {canManage && (
              <CardFooter>
                <Button onClick={() => openUpgradeDialog()}>Upgrade</Button>
              </CardFooter>
            )}
          </Card>
        ) : (
          <>
            {activeSub.cancelAtPeriodEnd ? (
              <Card className="border-destructive/40">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <IconForWarning className="text-destructive" />
                    <CardTitle>Subscription ending</CardTitle>
                  </div>
                  <CardDescription>
                    Your subscription is set to cancel. Access ends on{" "}
                    {formatDate(
                      activeSub.cancelAt ??
                        activeSub.periodEnd ??
                        new Date(),
                    )}
                    .
                  </CardDescription>
                </CardHeader>
                {canManage && (
                  <CardFooter>
                    <Button
                      onClick={handleRestore}
                      disabled={actionPending !== null}
                    >
                      {actionPending === "restore"
                        ? "Restoring..."
                        : "Keep subscription"}
                    </Button>
                  </CardFooter>
                )}
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <IconForVerified className="text-muted-foreground" />
                  <CardTitle>{planDisplayName(activeSub.plan)}</CardTitle>
                  <Badge variant={statusBadgeVariant(activeSub.status)}>
                    {activeSub.status}
                  </Badge>
                </div>
                <CardDescription>
                  Your organization&apos;s current subscription.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {activeSub.status === "trialing" && activeSub.trialEnd && (
                  <div className="grid gap-1">
                    <span className="text-sm font-medium text-muted-foreground">
                      Trial ends
                    </span>
                    <span className="text-sm">
                      {formatDate(activeSub.trialEnd)}
                    </span>
                  </div>
                )}
                {activeSub.periodEnd && (
                  <div className="grid gap-1">
                    <span className="text-sm font-medium text-muted-foreground">
                      {activeSub.cancelAtPeriodEnd ? "Access ends" : "Renews"}
                    </span>
                    <span className="text-sm">
                      {formatDate(activeSub.periodEnd)}
                    </span>
                  </div>
                )}
                {activeSub.limits && (
                  <LimitsList
                    limits={activeSub.limits as Record<string, unknown>}
                  />
                )}
              </CardContent>
              {canManage && (
                <CardFooter className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() =>
                      openUpgradeDialog(
                        activeSub.stripeSubscriptionId ?? undefined,
                      )
                    }
                  >
                    Change plan
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleManageBilling}
                    disabled={actionPending !== null}
                  >
                    {actionPending === "portal"
                      ? "Opening..."
                      : "Manage billing"}
                  </Button>
                  {!activeSub.cancelAtPeriodEnd && (
                    <Button
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={handleCancel}
                      disabled={actionPending !== null}
                    >
                      {actionPending === "cancel"
                        ? "Canceling..."
                        : "Cancel subscription"}
                    </Button>
                  )}
                </CardFooter>
              )}
            </Card>
          </>
        )}
      </PageBody>
    </Page>
  );
}
