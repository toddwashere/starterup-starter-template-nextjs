import { prisma } from "@workspace/database";

const BILLING_MANAGE_ROLES = new Set(["owner", "admin"]);

export async function authorizeOrgBilling({
  user,
  referenceId,
}: {
  user: { id: string };
  referenceId: string;
  action: string;
}) {
  const member = await prisma.member.findFirst({
    where: { userId: user.id, organizationId: referenceId },
    select: { role: true },
  });
  return !!member && BILLING_MANAGE_ROLES.has(member.role);
}
