import { faker } from "@faker-js/faker";
import { createId } from "@workspace/common/create-id";

export type UserFixture = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: string;
  createdAt: Date;
  updatedAt: Date;
};

export function buildUser(overrides: Partial<UserFixture> = {}): UserFixture {
  const now = new Date();
  return {
    id: createId("user"),
    name: faker.person.fullName(),
    email: faker.internet.email().toLowerCase(),
    emailVerified: true,
    role: "user",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
