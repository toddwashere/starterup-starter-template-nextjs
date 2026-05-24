import { faker } from "@faker-js/faker";
import { createId } from "@workspace/common/create-id";

export type OrganizationFixture = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
};

export function buildOrganization(
  overrides: Partial<OrganizationFixture> = {},
): OrganizationFixture {
  const name = overrides.name ?? faker.company.name();
  const now = new Date();
  return {
    id: createId("org"),
    name,
    slug: faker.helpers.slugify(name).toLowerCase(),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
