import { createMockPrisma, type MockPrismaOverrides } from "./create-mock-prisma";

export function mockDatabaseModule(overrides?: MockPrismaOverrides) {
  return { prisma: createMockPrisma(overrides) };
}
