import { vi } from "vitest";

type MockFn = ReturnType<typeof vi.fn>;

type ModelDelegate = {
  findMany: MockFn;
  findFirst: MockFn;
  findUnique: MockFn;
  create: MockFn;
  update: MockFn;
  delete: MockFn;
  count: MockFn;
  upsert: MockFn;
  [key: string]: MockFn;
};

type ModelOverrides = Partial<Record<keyof ModelDelegate, MockFn>>;

function createModelDelegate(overrides: ModelOverrides = {}): ModelDelegate {
  return {
    findMany: overrides["findMany"] ?? vi.fn(),
    findFirst: overrides["findFirst"] ?? vi.fn(),
    findUnique: overrides["findUnique"] ?? vi.fn(),
    create: overrides["create"] ?? vi.fn(),
    update: overrides["update"] ?? vi.fn(),
    delete: overrides["delete"] ?? vi.fn(),
    count: overrides["count"] ?? vi.fn(),
    upsert: overrides["upsert"] ?? vi.fn(),
    ...overrides,
  };
}

export type MockPrismaOverrides = {
  contact?: ModelOverrides;
  user?: ModelOverrides;
  organization?: ModelOverrides;
  member?: ModelOverrides;
};

export function createMockPrisma(overrides: MockPrismaOverrides = {}) {
  return {
    contact: createModelDelegate(overrides.contact),
    user: createModelDelegate(overrides.user),
    organization: createModelDelegate(overrides.organization),
    member: createModelDelegate(overrides.member),
  };
}

export type MockPrisma = ReturnType<typeof createMockPrisma>;
