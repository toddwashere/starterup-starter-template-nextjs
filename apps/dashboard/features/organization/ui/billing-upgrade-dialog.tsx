"use client";

import { useMemo, useState } from "react";
import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { authClient } from "@workspace/auth/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Button } from "@workspace/ui/components/button";
import { Label } from "@workspace/ui/components/label";
import { Switch } from "@workspace/ui/components/switch";
import { RadioCardItem, RadioCards } from "@workspace/ui/components/radio-cards";
import { toast } from "@workspace/ui/components/sonner";
import type { PublicBillingPlan } from "../data/billing-actions";
import { formatLimitLabel } from "./billing-format";

export const BillingUpgradeDialog = NiceModal.create(
  ({
    referenceId,
    orgSlug,
    subscriptionId,
    plans,
  }: {
    referenceId: string;
    orgSlug: string;
    subscriptionId?: string;
    plans: PublicBillingPlan[];
  }) => {
    const modal = useModal();
    // The `free` plan is shown on the billing page but is not a checkout option.
    const upgradablePlans = useMemo(
      () => plans.filter((plan) => plan.name !== "free"),
      [plans],
    );
    const [isAnnual, setIsAnnual] = useState(false);
    const [selectedPlan, setSelectedPlan] = useState<string>(
      upgradablePlans[0]?.name ?? "",
    );
    const [isLoading, setIsLoading] = useState(false);

    const annualAvailable = useMemo(
      () => upgradablePlans.some((plan) => plan.hasAnnual),
      [upgradablePlans],
    );

    const selected = upgradablePlans.find((plan) => plan.name === selectedPlan);

    const handleCheckout = async () => {
      if (!selected) return;
      setIsLoading(true);
      try {
        const checkoutUrl =
          typeof window !== "undefined"
            ? `${window.location.origin}/${orgSlug}/settings/billing`
            : undefined;
        const result = await authClient.subscription.upgrade({
          plan: selected.name,
          // `annual` only applies to plans that offer an annual price.
          annual: selected.hasAnnual ? isAnnual : false,
          referenceId,
          subscriptionId,
          customerType: "organization",
          successUrl: checkoutUrl,
          cancelUrl: checkoutUrl,
        });
        const url = (result as { url?: string })?.url;
        if (url && typeof window !== "undefined") {
          window.location.href = url;
          return;
        }
        toast.error("Unable to start checkout. Please try again.");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to start checkout",
        );
      } finally {
        setIsLoading(false);
      }
    };

    return (
      <Dialog
        open={modal.visible}
        onOpenChange={(open) => !open && modal.hide()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {subscriptionId ? "Change plan" : "Upgrade plan"}
            </DialogTitle>
            <DialogDescription>
              Choose a plan for your organization. You will be taken to a secure
              checkout page to complete the change.
            </DialogDescription>
          </DialogHeader>

          {upgradablePlans.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No plans are currently available.
            </p>
          ) : (
            <div className="space-y-4">
              {annualAvailable && (
                <div className="flex items-center justify-between rounded-md border border-input p-3">
                  <Label htmlFor="annual-toggle" className="text-sm font-medium">
                    Billed annually
                  </Label>
                  <Switch
                    id="annual-toggle"
                    checked={isAnnual}
                    onCheckedChange={setIsAnnual}
                  />
                </div>
              )}

              <RadioCards
                value={selectedPlan}
                onValueChange={setSelectedPlan}
              >
                {upgradablePlans.map((plan) => {
                  const limitEntries = Object.entries(plan.limits);
                  return (
                    <RadioCardItem key={plan.name} value={plan.name}>
                      <span className="block text-sm font-semibold">
                        {plan.displayName}
                        {isAnnual && plan.hasAnnual ? " (annual)" : ""}
                      </span>
                      {limitEntries.length > 0 && (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {limitEntries
                            .map(
                              ([key, value]) =>
                                `${formatLimitLabel(key)}: ${value.toLocaleString()}`,
                            )
                            .join(" · ")}
                        </span>
                      )}
                    </RadioCardItem>
                  );
                })}
              </RadioCards>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={modal.hide}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCheckout}
              disabled={isLoading || !selected}
            >
              {isLoading ? "Redirecting..." : "Continue to checkout"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
);
