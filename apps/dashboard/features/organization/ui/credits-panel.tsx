"use client";

import NiceModal from "@ebay/nice-modal-react";
import { useQuery } from "@tanstack/react-query";
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
import { Skeleton } from "@workspace/ui/components/skeleton";
import { formatDate } from "@workspace/common";
import { getCreditOverviewForOrg, listPublicCreditTopUpProducts } from "../data/credit-actions";
import { CreditTopUpDialog } from "./credit-top-up-dialog";

function formatSignedCredits(effect: "increase" | "decrease", amount: number) {
  const sign = effect === "increase" ? "+" : "-";
  return `${sign}${amount.toLocaleString()}`;
}

export function CreditsPanel({
  organizationId,
  orgSlug,
  canManage,
}: {
  organizationId: string;
  orgSlug: string;
  canManage: boolean;
}) {
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ["credit-overview", organizationId],
    queryFn: () => getCreditOverviewForOrg(organizationId),
  });
  const { data: products } = useQuery({
    queryKey: ["credit-top-up-products"],
    queryFn: () => listPublicCreditTopUpProducts(),
  });

  if (overviewLoading) {
    return <Skeleton className="h-48 w-full" />;
  }
  if (!overview) return null;

  const balance = overview.balance;
  const hasTopUps = (products?.length ?? 0) > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>AI Credits</CardTitle>
            <CardDescription>Organization credit balance and activity.</CardDescription>
          </div>
          {balance.totalBalanceCredits <= 0 && (
            <Badge variant="outline">Add credits to continue</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <div className="text-sm text-muted-foreground">Total</div>
            <div className="text-2xl font-semibold">
              {balance.totalBalanceCredits.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Allowance</div>
            <div className="text-2xl font-semibold">
              {balance.monthlyAllowanceBalanceCredits.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Wallet</div>
            <div className="text-2xl font-semibold">
              {balance.walletBalanceCredits.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Overdraft</div>
            <div className="text-2xl font-semibold">
              {balance.overdraftCredits.toLocaleString()}
            </div>
          </div>
        </div>

        {balance.currentPeriodEnd && (
          <div className="text-sm text-muted-foreground">
            Renews {formatDate(balance.currentPeriodEnd)}
          </div>
        )}

        {overview.activity.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium text-muted-foreground">Recent activity</div>
            <div className="divide-y rounded-md border">
              {overview.activity.map((event) => {
                const movement = event.ledgerEntries[0];
                return (
                  <div
                    key={event.id}
                    className="flex items-center justify-between gap-3 p-3 text-sm"
                  >
                    <div>
                      <div className="font-medium">{event.usageArea.replaceAll("_", " ")}</div>
                      <div className="text-muted-foreground">{formatDate(event.createdAt)}</div>
                    </div>
                    <div className="font-medium">
                      {movement
                        ? formatSignedCredits(movement.effect, movement.amountCredits)
                        : "no charge"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
      {canManage && hasTopUps && (
        <CardFooter>
          <Button
            variant="outline"
            onClick={() =>
              NiceModal.show(CreditTopUpDialog, {
                organizationId,
                orgSlug,
                products: products ?? [],
              })
            }
          >
            Buy credits
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
