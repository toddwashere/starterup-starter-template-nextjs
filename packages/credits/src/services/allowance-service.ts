import { grantCredits } from "./usage-service";

export type AllowanceUnusedPolicy = "expire" | "rollover";

export type CreditPlanPolicy = {
  monthlyAllowanceCredits?: number;
  allowanceUnusedPolicy?: AllowanceUnusedPolicy;
  rolloverCapCredits?: number;
  markupBasisPoints?: number;
  chargeToOrgDefault?: boolean;
};

export async function grantMonthlyAllowance(input: {
  organizationId: string;
  planName: string;
  periodStart: Date;
  periodEnd: Date;
  policy: CreditPlanPolicy | null | undefined;
}) {
  const amountCredits = input.policy?.monthlyAllowanceCredits ?? 0;
  if (!Number.isInteger(amountCredits) || amountCredits <= 0) {
    return null;
  }

  return grantCredits({
    organizationId: input.organizationId,
    amountCredits,
    bucket: "monthly_allowance",
    source: "system",
    usageArea: "monthly_allowance",
    idempotencyKey: `monthly_allowance:${input.organizationId}:${input.planName}:${input.periodStart.toISOString()}`,
    metadata: {
      planName: input.planName,
      periodStart: input.periodStart.toISOString(),
      periodEnd: input.periodEnd.toISOString(),
      allowanceUnusedPolicy: input.policy?.allowanceUnusedPolicy ?? "expire",
      rolloverCapCredits: input.policy?.rolloverCapCredits ?? null,
    },
  });
}
