import { prisma } from "@workspace/database";
import { PublicApiOrgError } from "./types";

export type UserOrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  role: string;
};

export { PublicApiOrgError };

export async function assertUserOrgMember(
  userId: string,
  organizationId: string,
): Promise<string> {
  const member = await prisma.member.findFirst({
    where: { userId, organizationId },
    select: { role: true },
  });
  if (!member) {
    throw new PublicApiOrgError(
      "FORBIDDEN",
      "Not a member of this organization",
    );
  }
  return member.role;
}

export async function listOrganizationsForUser(
  userId: string,
): Promise<UserOrganizationSummary[]> {
  const members = await prisma.member.findMany({
    where: { userId },
    select: {
      role: true,
      organization: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { organization: { name: "asc" } },
  });
  return members.map((m: (typeof members)[number]) => ({
    id: m.organization.id,
    name: m.organization.name,
    slug: m.organization.slug,
    role: m.role,
  }));
}
