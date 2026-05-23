import { prisma } from "@workspace/database";

export async function getActiveSubscriptionForOrg(orgId: string) {
  return prisma.subscription.findFirst({
    where: { referenceId: orgId, status: { in: ["active", "trialing"] } },
    orderBy: { periodEnd: "desc" },
  });
}
