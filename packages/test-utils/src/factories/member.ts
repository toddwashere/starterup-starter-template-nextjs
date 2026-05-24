import { createId } from "@workspace/common/create-id";
import { buildUser, type UserFixture } from "./user";
import { buildOrganization, type OrganizationFixture } from "./organization";

export type MemberFixture = {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: Date;
};

export function buildMember(
  overrides: Partial<MemberFixture> & {
    user?: UserFixture;
    organization?: OrganizationFixture;
  } = {},
): MemberFixture {
  const user = overrides.user ?? buildUser();
  const org = overrides.organization ?? buildOrganization();
  return {
    id: createId("mbr"),
    organizationId: org.id,
    userId: user.id,
    role: "member",
    createdAt: new Date(),
    ...overrides,
  };
}
