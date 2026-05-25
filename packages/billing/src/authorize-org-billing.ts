import { parseOrgRoles } from "@workspace/common";
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
  return !!member && parseOrgRoles(member.role).some((r) => BILLING_MANAGE_ROLES.has(r));
}
