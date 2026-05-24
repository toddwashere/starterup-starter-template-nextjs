import { vi } from "vitest";

const DEFAULT_METHODS = [
  "findMany",
  "findFirst",
  "findUnique",
  "create",
  "update",
  "delete",
  "count",
  "upsert",
] as const;

type MockFn = ReturnType<typeof vi.fn>;

function createModelDelegate(
  overrides: Record<string, MockFn> = {},
): Record<string, MockFn> {
  const delegate: Record<string, MockFn> = {};
  for (const method of DEFAULT_METHODS) {
    delegate[method] = overrides[method] ?? vi.fn();
  }
  for (const [key, fn] of Object.entries(overrides)) {
    delegate[key] = fn;
  }
  return delegate;
}

export type MockPrismaOverrides = {
  contact?: Partial<Record<string, MockFn>>;
  user?: Partial<Record<string, MockFn>>;
  organization?: Partial<Record<string, MockFn>>;
  member?: Partial<Record<string, MockFn>>;
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
