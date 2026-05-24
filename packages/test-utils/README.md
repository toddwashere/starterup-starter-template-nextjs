# @workspace/test-utils

Dev-only test utilities for the workspace. Provides Prisma mock helpers and faker-based entity factories.

## Installation

Add as a `devDependency` in your package:

```json
"devDependencies": {
  "@workspace/test-utils": "workspace:*"
}
```

Then run `pnpm install`.

## Usage

### Prisma mocks

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

Or use `mockDatabaseModule` as a one-liner factory:

```typescript
import { mockDatabaseModule } from "@workspace/test-utils";

vi.mock("@workspace/database", () => mockDatabaseModule());
```

### Factories

```typescript
import { buildUser, buildOrganization, buildMember, buildContact } from "@workspace/test-utils/factories";

const user = buildUser({ email: "alice@example.com" });
const org = buildOrganization({ name: "Acme Corp" });
const member = buildMember({ user, organization: org });
const contact = buildContact({ organizationId: org.id, displayName: "Jane Doe" });
```

All factories accept partial overrides and return plain objects.

## API

### `createMockPrisma(overrides?)`

Returns a mock Prisma client with `vi.fn()` methods on each model delegate (`contact`, `user`, `organization`, `member`). Each model has: `findMany`, `findFirst`, `findUnique`, `create`, `update`, `delete`, `count`, `upsert`.

### `mockDatabaseModule(overrides?)`

Returns `{ prisma: createMockPrisma(overrides) }` — pass directly to `vi.mock`.

### `buildUser(overrides?)` → `UserFixture`
### `buildOrganization(overrides?)` → `OrganizationFixture`
### `buildMember(overrides?)` → `MemberFixture`
### `buildContact(overrides)` → `ContactFixture` (requires `organizationId`)
