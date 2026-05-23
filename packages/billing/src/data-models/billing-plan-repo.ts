import { prisma } from "@workspace/database";

export async function listActiveBillingPlans() {
  return prisma.billingPlan.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
}

export async function getBillingPlanByName(name: string) {
  return prisma.billingPlan.findUnique({ where: { name } });
}
