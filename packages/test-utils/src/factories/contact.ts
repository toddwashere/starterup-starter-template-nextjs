import { faker } from "@faker-js/faker";
import { createId } from "@workspace/common/create-id";

export type ContactFixture = {
  id: string;
  organizationId: string;
  kind: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  website: string | null;
  parentContactId: string | null;
  stageId: string | null;
  ownerId: string | null;
  source: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

export function buildContact(
  overrides: Partial<ContactFixture> & { organizationId: string },
): ContactFixture {
  const first = faker.person.firstName();
  const last = faker.person.lastName();
  const now = new Date();
  return {
    id: createId("contact"),
    kind: "person",
    displayName: `${first} ${last}`,
    firstName: first,
    lastName: last,
    companyName: null,
    primaryEmail: faker.internet.email().toLowerCase(),
    primaryPhone: null,
    website: null,
    parentContactId: null,
    stageId: null,
    ownerId: null,
    source: null,
    status: "active",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ...overrides,
  };
}
