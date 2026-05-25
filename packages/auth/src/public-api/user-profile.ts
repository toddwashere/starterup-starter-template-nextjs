import { prisma } from "@workspace/database";

export type PublicApiUserProfile = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  activeOrganizationId: string | null;
};

export async function getUserProfileForPublicApi(
  userId: string,
): Promise<PublicApiUserProfile | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, image: true },
  });
  if (!user) return null;

  const session = await prisma.session.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: { activeOrganizationId: true },
  });

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    activeOrganizationId: session?.activeOrganizationId ?? null,
  };
}
