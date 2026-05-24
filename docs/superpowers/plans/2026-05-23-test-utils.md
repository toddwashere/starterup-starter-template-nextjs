# Test Utils Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@workspace/test-utils` with `createMockPrisma()`, `mockDatabaseModule()`, and faker factories for User, Org, Member, and Contact; migrate two existing tests as adoption proof.

**Architecture:** Dev-only package consumed from `*.test.ts` files. Mocks use Vitest `vi.fn()` nested delegates matching repo style. Factories use `@workspace/common` `createId` + `@faker-js/faker`.

**Tech Stack:** Vitest, `@faker-js/faker`, TypeScript.

**Design spec:** [`docs/superpowers/specs/2026-05-23-test-utils-design.md`](../specs/2026-05-23-test-utils-design.md)

**Independent of:** typed-env and CI plans (can run in parallel).

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/test-utils/package.json` | Package manifest |
| `packages/test-utils/src/prisma/create-mock-prisma.ts` | Nested prisma mock |
| `packages/test-utils/src/prisma/mock-database-module.ts` | `vi.mock` helper |
| `packages/test-utils/src/factories/user.ts` | `buildUser()` |
| `packages/test-utils/src/factories/organization.ts` | `buildOrganization()` |
| `packages/test-utils/src/factories/member.ts` | `buildMember()` |
| `packages/test-utils/src/factories/contact.ts` | `buildContact()` |
| `packages/test-utils/src/factories/index.ts` | Re-exports |
| `packages/test-utils/src/index.ts` | Root re-exports |
| `packages/test-utils/README.md` | Usage examples |
| `packages/contacts/src/data-models/contact-repo.test.ts` | Adoption #1 |
| `packages/auth/src/guards.test.ts` | Adoption #2 (session fixture via `buildUser`) |

---

## Critical Tests

- `packages/test-utils/src/prisma/create-mock-prisma.test.ts`: nested delegates; override works; methods are `vi.fn()`.
- `packages/test-utils/src/factories/contact.test.ts`: shape + overrides + `organizationId`.
- `packages/test-utils/src/factories/user.test.ts`: distinct emails across calls.

---

### Task 1: Scaffold `@workspace/test-utils`

**Files:**
- Create: `packages/test-utils/package.json`
- Create: `packages/test-utils/tsconfig.json`
- Create: `packages/test-utils/vitest.config.ts`
- Create: `packages/test-utils/eslint.config.mjs`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@workspace/test-utils",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./prisma": "./src/prisma/create-mock-prisma.ts",
    "./factories": "./src/factories/index.ts"
  },
  "scripts": {
    "type-check": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run"
  },
  "dependencies": {
    "@faker-js/faker": "^10",
    "@workspace/common": "workspace:*"
  },
  "devDependencies": {
    "@workspace/tooling": "workspace:*",
    "typescript": "^5.7",
    "vitest": "^3"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "@workspace/tooling/typescript/base.json",
  "compilerOptions": {
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts` and `eslint.config.mjs`**

Match sibling packages (`packages/contacts/vitest.config.ts`, `packages/billing/eslint.config.mjs`).

- [ ] **Step 4: Install**

Run: `pnpm install`

- [ ] **Step 5: Commit**

```bash
git add packages/test-utils/
git commit -m "chore(test-utils): scaffold package"
```

---

### Task 2: `createMockPrisma()`

**Files:**
- Create: `packages/test-utils/src/prisma/create-mock-prisma.ts`
- Create: `packages/test-utils/src/prisma/create-mock-prisma.test.ts`
- Create: `packages/test-utils/src/prisma/mock-database-module.ts`

- [ ] **Step 1: Write failing test**

Create `packages/test-utils/src/prisma/create-mock-prisma.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { createMockPrisma } from "./create-mock-prisma";

describe("createMockPrisma", () => {
  it("returns nested model delegates with vi.fn methods", () => {
    const prisma = createMockPrisma();
    expect(prisma.contact.findMany).toBeTypeOf("function");
    expect(vi.isMockFunction(prisma.contact.findMany)).toBe(true);
  });

  it("applies per-model overrides", async () => {
    const prisma = createMockPrisma({
      contact: {
        findMany: vi.fn().mockResolvedValue([{ id: "contact_x" }]),
      },
    });
    const rows = await prisma.contact.findMany();
    expect(rows).toEqual([{ id: "contact_x" }]);
  });
});
```

- [ ] **Step 2: Implement `create-mock-prisma.ts`**

```typescript
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
```

- [ ] **Step 3: Implement `mock-database-module.ts`**

```typescript
import { createMockPrisma, type MockPrismaOverrides } from "./create-mock-prisma";

export function mockDatabaseModule(overrides?: MockPrismaOverrides) {
  return { prisma: createMockPrisma(overrides) };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @workspace/test-utils test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/test-utils/src/prisma/
git commit -m "feat(test-utils): add createMockPrisma helper"
```

---

### Task 3: Entity factories

**Files:**
- Create: `packages/test-utils/src/factories/user.ts`
- Create: `packages/test-utils/src/factories/user.test.ts`
- Create: `packages/test-utils/src/factories/organization.ts`
- Create: `packages/test-utils/src/factories/member.ts`
- Create: `packages/test-utils/src/factories/contact.ts`
- Create: `packages/test-utils/src/factories/contact.test.ts`
- Create: `packages/test-utils/src/factories/index.ts`

- [ ] **Step 1: Write failing factory tests**

`contact.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildContact } from "./contact";

describe("buildContact", () => {
  it("returns a person contact with required fields", () => {
    const contact = buildContact({ organizationId: "org_1" });
    expect(contact.organizationId).toBe("org_1");
    expect(contact.kind).toBe("person");
    expect(contact.id).toMatch(/^contact_/);
    expect(contact.displayName).toBeTruthy();
  });

  it("merges overrides", () => {
    const contact = buildContact({
      organizationId: "org_1",
      displayName: "Override Name",
    });
    expect(contact.displayName).toBe("Override Name");
  });
});
```

`user.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildUser } from "./user";

describe("buildUser", () => {
  it("generates distinct emails by default", () => {
    const a = buildUser();
    const b = buildUser();
    expect(a.email).not.toBe(b.email);
  });
});
```

- [ ] **Step 2: Implement factories**

`user.ts`:

```typescript
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
```

`organization.ts`:

```typescript
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
```

`member.ts`:

```typescript
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
```

`contact.ts`:

```typescript
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
```

`index.ts`:

```typescript
export { buildUser, type UserFixture } from "./user";
export { buildOrganization, type OrganizationFixture } from "./organization";
export { buildMember, type MemberFixture } from "./member";
export { buildContact, type ContactFixture } from "./contact";
```

- [ ] **Step 3: Run factory tests**

Run: `pnpm --filter @workspace/test-utils test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/test-utils/src/factories/
git commit -m "feat(test-utils): add entity factories"
```

---

### Task 4: Root exports + README

**Files:**
- Create: `packages/test-utils/src/index.ts`
- Create: `packages/test-utils/README.md`

- [ ] **Step 1: Create `src/index.ts`**

```typescript
export { createMockPrisma, type MockPrisma, type MockPrismaOverrides } from "./prisma/create-mock-prisma";
export { mockDatabaseModule } from "./prisma/mock-database-module";
export * from "./factories";
```

- [ ] **Step 2: Write README**

Document:

```typescript
import { vi } from "vitest";
import { createMockPrisma } from "@workspace/test-utils/prisma";
import { buildContact } from "@workspace/test-utils/factories";

vi.mock("@workspace/database", () => ({
  prisma: createMockPrisma({
    contact: {
      findMany: vi.fn().mockResolvedValue([buildContact({ organizationId: "org_1" })]),
    },
  }),
}));
```

- [ ] **Step 3: Commit**

```bash
git add packages/test-utils/src/index.ts packages/test-utils/README.md
git commit -m "docs(test-utils): add README and root exports"
```

---

### Task 5: Adopt in `contact-repo.test.ts`

**Files:**
- Modify: `packages/contacts/package.json` (add devDependency)
- Modify: `packages/contacts/src/data-models/contact-repo.test.ts`

- [ ] **Step 1: Add devDependency**

In `packages/contacts/package.json` `devDependencies`:

```json
"@workspace/test-utils": "workspace:*"
```

Run: `pnpm install`

- [ ] **Step 2: Refactor test file**

Replace manual mock + `mockContact` with:

```typescript
import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockPrisma } from "@workspace/test-utils/prisma";
import { buildContact } from "@workspace/test-utils/factories";

const mockContact = buildContact({ organizationId: "org_1" });

vi.mock("@workspace/database", () => ({
  prisma: createMockPrisma(),
}));

import { prisma } from "@workspace/database";
// ... rest unchanged, use mockContact
```

- [ ] **Step 3: Run contacts tests**

Run: `pnpm --filter @workspace/contacts test contact-repo.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/contacts/
git commit -m "test(contacts): adopt @workspace/test-utils in contact-repo tests"
```

---

### Task 6: Adopt in `guards.test.ts`

**Files:**
- Modify: `packages/auth/package.json`
- Modify: `packages/auth/src/guards.test.ts`

- [ ] **Step 1: Add devDependency to auth**

```json
"@workspace/test-utils": "workspace:*"
```

- [ ] **Step 2: Replace inline `fakeSession.user` with factory**

```typescript
import { buildUser } from "@workspace/test-utils/factories";

const user = buildUser({ id: "u1", email: "test@example.com", name: "Test User" });

const fakeSession = {
  user: {
    ...user,
    role: "user" as string,
  },
  session: {
    id: "s1",
    token: "tok_abc",
    userId: user.id,
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};
```

- [ ] **Step 3: Run auth tests**

Run: `pnpm --filter @workspace/auth test guards.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/auth/
git commit -m "test(auth): adopt buildUser factory in guards tests"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 2: Type-check and lint**

Run: `pnpm type-check && pnpm lint`
Expected: PASS

---

## Verification checklist

- [ ] `@workspace/test-utils` tests pass
- [ ] `contact-repo.test.ts` and `guards.test.ts` use test-utils
- [ ] No production imports of `@workspace/test-utils` (grep check)
- [ ] README documents mock + factory pattern
