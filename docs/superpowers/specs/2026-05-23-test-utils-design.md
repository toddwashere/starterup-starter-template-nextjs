# Test Utils Package Design

**Date:** 2026-05-23  
**Status:** Approved

## Overview

Add `@workspace/test-utils` — a dev-only package with Prisma mock helpers and faker-based entity factories. Reduces hand-rolled mocks and inline fixture objects in repo/service tests (e.g. `contact-repo.test.ts`). v1 ships Prisma mocks + User, Org, Member, and Contact factories. Stripe mocks are deferred.

---

## Decisions

| Topic | Decision |
|-------|----------|
| **Package name** | `@workspace/test-utils` |
| **Visibility** | `private: true`; devDependency for consumers only |
| **Mock strategy** | Vitest `vi.fn()` nested mocks (matches repo style; not `jest-mock-extended`) |
| **Factories** | `@faker-js/faker` builders with override merge |
| **v1 entities** | User, Organization, Member, Contact |
| **Stripe mocks** | Out of scope v1 |
| **Adoption proof** | Migrate two existing test files |

---

## Scope

### In scope

- New `packages/test-utils` with exports for prisma mocks and factories
- `createMockPrisma()` — typed nested mock of `prisma` client
- `mockDatabaseModule()` helper for `vi.mock("@workspace/database")`
- Factories: `buildUser`, `buildOrganization`, `buildMember`, `buildContact`
- Package `README.md` with usage examples
- Migrate two existing tests to demonstrate pattern
- Unit tests for mock helper and factories

### Out of scope (v1)

- Stripe mocks / webhook event fixtures
- Real Postgres integration test helpers
- Seed scripts
- Factories for billing, AI, or other domains
- ESLint rule restricting test-utils imports to `*.test.ts` (convention only)
- Changes to CI beyond existing `pnpm test`

---

## Package structure

```text
packages/test-utils/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
└── src/
    ├── index.ts
    ├── prisma/
    │   ├── create-mock-prisma.ts
    │   ├── create-mock-prisma.test.ts
    │   └── mock-database-module.ts
    └── factories/
        ├── index.ts
        ├── user.ts
        ├── user.test.ts
        ├── organization.ts
        ├── member.ts
        ├── contact.ts
        └── contact.test.ts
```

---

## Exports

```json
{
  "name": "@workspace/test-utils",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./prisma": "./src/prisma/create-mock-prisma.ts",
    "./factories": "./src/factories/index.ts"
  }
}
```

---

## `createMockPrisma()`

Returns a mock `prisma` client suitable for `vi.mock("@workspace/database")`:

- Top-level model delegates (`contact`, `user`, `organization`, `member`, etc.) are objects with common Prisma methods as `vi.fn()` (`findMany`, `findFirst`, `findUnique`, `create`, `update`, `delete`, `count`, …).
- Accept optional partial overrides per model for test-specific setup.
- Typed enough for autocomplete on frequently used models in v1 (at minimum: `contact`, `user`, `organization`, `member`).

**Example usage:**

```typescript
import { createMockPrisma } from "@workspace/test-utils/prisma";

const prisma = createMockPrisma({
  contact: {
    findMany: vi.fn().mockResolvedValue([buildContact()]),
  },
});

vi.mock("@workspace/database", () => ({ prisma }));
```

---

## `mockDatabaseModule()`

Optional helper that returns the factory object for `vi.mock`:

```typescript
export function mockDatabaseModule(overrides?: MockPrismaOverrides) {
  return { prisma: createMockPrisma(overrides) };
}

// vi.mock("@workspace/database", () => mockDatabaseModule({ ... }));
```

Keep API minimal — one-liner setup is the goal.

---

## Factories

Each factory: `buildX(overrides?: Partial<T>): T`

| Factory | Shape | Defaults |
|---------|-------|----------|
| `buildUser()` | User-like | `id` via `@workspace/common` `createId("user")`, faker email/name, `emailVerified: true` |
| `buildOrganization()` | Organization-like | `createId("org")`, faker company name, slug from name |
| `buildMember()` | Member-like | links user + org, `role: "member"` |
| `buildContact()` | Contact-like | `createId("contact")`, `kind: "person"`, faker displayName/email, `organizationId` required or overridable |

**Rules:**

- Return plain objects (not Prisma model instances).
- Overrides shallow-merge onto defaults.
- IDs use project prefix conventions from `@workspace/common` `createId`.
- Factories are deterministic enough for assertions (fixed seeds optional; not required v1).

---

## Adoption (v1 proof)

Migrate **two** existing test files:

1. **`packages/contacts/src/data-models/contact-repo.test.ts`** — replace inline `mockContact` and manual `vi.mock` with `buildContact()` + `createMockPrisma()`.
2. **One auth test** with hand-rolled user/org mocks — pick at implementation time (e.g. `packages/auth/src/guards.test.ts` or `permissions.test.ts` if applicable).

Document before/after in package README.

---

## Dependencies

```json
{
  "dependencies": {
    "@faker-js/faker": "^10",
    "@workspace/common": "workspace:*",
    "@workspace/database": "workspace:*"
  },
  "devDependencies": {
    "@workspace/tooling": "workspace:*",
    "typescript": "^5.7",
    "vitest": "^3"
  }
}
```

Consumers add `@workspace/test-utils` as a **devDependency**.

**Convention:** Never import `@workspace/test-utils` from production code (`apps/*/features`, `packages/*/src` excluding tests).

---

## Architecture

```text
packages/contacts/src/data-models/contact-repo.test.ts
packages/auth/src/*.test.ts
        │
        ▼
@workspace/test-utils
        ├── createMockPrisma()  ──► vi.mock("@workspace/database")
        └── buildContact() / buildUser() / …
                    │
                    ▼
              @faker-js/faker
              @workspace/common (createId)
```

---

## Dependencies on other specs

| Spec | Relationship |
|------|--------------|
| [Typed env validation](./2026-05-23-typed-env-validation-design.md) | Independent |
| [CI workflows](./2026-05-23-ci-workflows-design.md) | Runs test-utils tests via `pnpm test` |
| [Observability Sentry](./2026-05-23-observability-sentry-design.md) | Independent |

Can implement in parallel with CI once the package exists.

---

## Critical Tests

- `packages/test-utils/src/prisma/create-mock-prisma.test.ts`: returns nested model delegates; per-model method override works; default methods are `vi.fn()`.
- `packages/test-utils/src/factories/contact.test.ts`: `buildContact()` satisfies expected shape; overrides merge correctly; `organizationId` can be set.
- `packages/test-utils/src/factories/user.test.ts`: `buildUser()` generates distinct emails across consecutive calls (or accepts override).

---

## Verification

- `pnpm --filter @workspace/test-utils test`
- `pnpm --filter @workspace/contacts test` (after adoption migration)
- `pnpm type-check`
- `pnpm lint`

---

## Follow-ups (not v1)

- `createMockStripe()` and Stripe webhook fixtures for billing tests
- Factories for `BillingPlan`, `Subscription`, API keys
- `withTestDatabase()` helper for integration tests against CI Postgres
- ESLint rule: ban `@workspace/test-utils` imports outside `*.test.ts`
