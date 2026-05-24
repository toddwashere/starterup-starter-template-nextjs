# Contacts Export Selected & Responsive Data Table Pattern — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cross-page row selection with bulk "Export selected" (CSV) and "Add selected to segment" to the contacts list, built on server-driven pagination, and establish a reusable `create-data-table` pattern documented as an AI skill.

**Architecture:** Lift `rowSelection` + TanStack pagination state into a new `ContactsList` shell that renders a desktop `DataTable` (md+) and a mobile card list (< md) over the same page of rows. Bulk actions operate on selected contact IDs server-side (org-scoped). Segment membership gains an explicit `contactIds` set via a backward-compatible **filter version 2** so "add to segment" needs no schema migration.

**Tech Stack:** Next.js (App Router) + React client components, `@tanstack/react-table` v8.21.3, Prisma (`@workspace/database`), Zod, PapaParse, NiceModal (`@ebay/nice-modal-react`), sonner toasts, Vitest.

**Reference spec:** `docs/superpowers/specs/2026-05-23-contacts-export-selected-and-data-table-pattern.md`

---

## Conventions for every task

- **Commit trailer:** every commit message in this plan must end with:
  ```
  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```
- **Test framework:** Vitest, colocated `*.test.ts(x)` next to source.
  - Domain package: `pnpm test --filter @workspace/contacts`
  - Dashboard app: `pnpm test --filter dashboard`
  - UI package: `pnpm test --filter @workspace/ui`
  - Targeted single file (faster): `pnpm --filter <pkg> exec vitest run <relative/path>`
- **Type-check / lint:** `pnpm type-check` and `pnpm lint` (turbo, all packages). Package-scoped: `pnpm --filter <pkg> type-check`.
- **No `lucide-react` in `apps/`** — icons come from `@workspace/ui/components/icon-for` (the `add-icon` convention). Inside `packages/ui` you import lucide directly.
- **Repos live under** `packages/<domain>/src/data-models/`; services under `services/`; both are re-exported from `@workspace/contacts` root.
- **Server actions** are plain async functions returning `ActionResult<T>` from `@/common/data/action-result` (`{ success: true; data } | { success: false; error }`). There is **no** `next-safe-action`. Org id + permission come from `requireOrgPermissionWithActiveOrg(permissions)` in `@workspace/auth/guards`, which returns `{ session, activeOrganizationId }`.

### State of the "partial work" (verified current baseline)

> **Important:** the spec's "partial work note" described domain changes that were
> present (uncommitted) at the start of planning but were **discarded during the
> session and are not git-recoverable**. The current `HEAD` (`ef06d16`) baseline is
> the *pre-landed* state. Everything below must be **built**, not just verified.
> The exact target source is reproduced in the relevant tasks.

| File (current `HEAD` state) | Present now | Must be built |
|------|-------------|---------------|
| `packages/contacts/src/data-models/contact-repo.ts` | old `listContactsForOrg` (inline `where`/`include`), CRUD helpers, `countContactsForOrg` | `contactListInclude`, `buildContactListWhere`, refactor `listContactsForOrg` to use them, `countContactsMatchingListFilters`, `listContactsByIds` |
| `packages/contacts/src/schemas/contact-schemas.ts` | `ContactListFiltersSchema.pageSize` is `.max(100).default(20)` | bump `.max(1000)` |
| `packages/contacts/src/schemas/segment-schemas.ts` | v1 only, `CURRENT_FILTER_VERSION = 1` | v2 schema + bump (Task 2) |
| `packages/contacts/src/services/segment-service.ts` | `validateSegmentFilters` (v1), `buildContactWhereFromSegment` (V1 param), `listContactsForSegment` | `validateSegmentFilters` v2, `buildSegmentMembershipWhere`, `countContactsForSegment`, `addContactsToSegment` |

---

# Phase 0 — Baseline

### Task 0: Confirm a clean, type-checking baseline

**Files:** none (verification only)

- [ ] **Step 1: Ensure Prisma client is generated** (needed for `@workspace/database` types)

Run: `pnpm --filter @workspace/database db:generate`
Expected: completes without error (Prisma Client generated). If this is a fresh worktree, also confirm a root `.env` exists (the script reads `../../.env`).

- [ ] **Step 2: Baseline type-check**

Run: `pnpm type-check`
Expected: PASS. (The landed domain changes already type-check.) If it fails, stop and resolve environment issues before continuing.

---

# Phase 1 — Domain layer (`packages/contacts`)

### Task 1: Build shared list `where`/`include` + count + `listContactsByIds` (+ pageSize bump)

> Rebuilds the discarded "landed" work. Target source below is the verbatim
> intended implementation. The current `contact-repo.ts` has an old
> `listContactsForOrg` with an inline `where`/`include` and no `contactListInclude`,
> `buildContactListWhere`, `countContactsMatchingListFilters`, or `listContactsByIds`.

**Files:**
- Modify: `packages/contacts/src/schemas/contact-schemas.ts`
- Modify: `packages/contacts/src/data-models/contact-repo.ts`
- Test: `packages/contacts/src/data-models/contact-repo.test.ts` (extend existing)

- [ ] **Step 1: Bump `pageSize` max to 1000**

In `contact-schemas.ts`, change the `ContactListFiltersSchema.pageSize` line from `.max(100)` to `.max(1000)`:

```ts
  pageSize: z.number().int().positive().max(1000).default(20),
```

- [ ] **Step 2: Write the failing tests**

Append to `contact-repo.test.ts`. Add `buildContactListWhere`, `countContactsMatchingListFilters`, `listContactsByIds` to the existing import from `./contact-repo`. The existing `vi.mock("@workspace/database", ...)` already stubs `prisma.contact.count` and `prisma.contact.findMany`.

```ts
import {
  buildContactListWhere,
  countContactsMatchingListFilters,
  listContactsByIds,
} from "./contact-repo";

describe("buildContactListWhere", () => {
  it("scopes to org and excludes archived by default", () => {
    expect(buildContactListWhere("org_1", {})).toEqual({
      organizationId: "org_1",
      archivedAt: null,
    });
  });

  it("uses OR-any-tag semantics for tagIds", () => {
    const where = buildContactListWhere("org_1", { tagIds: ["t1", "t2"] });
    expect(where).toMatchObject({
      tags: { some: { tagId: { in: ["t1", "t2"] } } },
    });
  });
});

describe("countContactsMatchingListFilters", () => {
  it("counts using the same where clause as the list query", async () => {
    vi.mocked(prisma.contact.count).mockResolvedValue(3 as never);
    await countContactsMatchingListFilters("org_1", { search: "ann", stageId: "stage_1" });
    const countWhere = vi.mocked(prisma.contact.count).mock.calls[0]?.[0]?.where;
    expect(countWhere).toEqual(
      buildContactListWhere("org_1", { search: "ann", stageId: "stage_1" }),
    );
  });
});

describe("listContactsByIds", () => {
  it("scopes to organizationId and excludes archived", async () => {
    vi.mocked(prisma.contact.findMany).mockResolvedValue([] as never);
    await listContactsByIds("org_1", ["c1", "c2"]);
    expect(prisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org_1", id: { in: ["c1", "c2"] }, archivedAt: null },
      }),
    );
  });

  it("returns [] without querying when no ids are given", async () => {
    const result = await listContactsByIds("org_1", []);
    expect(result).toEqual([]);
    expect(prisma.contact.findMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `pnpm --filter @workspace/contacts exec vitest run src/data-models/contact-repo.test.ts`
Expected: FAIL — `buildContactListWhere`, `countContactsMatchingListFilters`, `listContactsByIds` are not exported.

- [ ] **Step 4: Implement in `contact-repo.ts`**

Add `contactListInclude` + `buildContactListWhere` near the top (after the imports), refactor `listContactsForOrg` to use them, and add the count + by-ids functions. Replace the existing `listContactsForOrg` (lines ~6-49) with this block:

```ts
export const contactListInclude = {
  stage: true,
  tags: { include: { tag: true } },
} as const;

export function buildContactListWhere(
  organizationId: string,
  filters: Partial<ContactListFilters> = {},
): Prisma.ContactWhereInput {
  const { search, kind, stageId, tagIds, includeArchived = false } = filters;

  return {
    organizationId,
    ...(kind ? { kind } : {}),
    ...(stageId ? { stageId } : {}),
    // OR semantics: contact matches if it has ANY of the listed tags.
    // Segment filters use AND semantics instead — see segment-service.ts.
    ...(tagIds?.length ? { tags: { some: { tagId: { in: tagIds } } } } : {}),
    ...(!includeArchived ? { archivedAt: null } : {}),
    ...(search
      ? {
          OR: [
            { displayName: { contains: search, mode: "insensitive" as const } },
            { primaryEmail: { contains: search, mode: "insensitive" as const } },
            { companyName: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
}

export async function listContactsForOrg(
  organizationId: string,
  filters: Partial<ContactListFilters> = {},
) {
  const { page = 1, pageSize = 20 } = filters;
  const where = buildContactListWhere(organizationId, filters);

  return prisma.contact.findMany({
    where,
    include: contactListInclude,
    orderBy: { displayName: "asc" },
    take: pageSize,
    skip: (page - 1) * pageSize,
  });
}

export async function countContactsMatchingListFilters(
  organizationId: string,
  filters: Partial<ContactListFilters> = {},
): Promise<number> {
  return prisma.contact.count({
    where: buildContactListWhere(organizationId, filters),
  });
}

export async function listContactsByIds(organizationId: string, contactIds: string[]) {
  if (contactIds.length === 0) {
    return [];
  }

  return prisma.contact.findMany({
    where: {
      organizationId,
      id: { in: contactIds },
      archivedAt: null,
    },
    include: contactListInclude,
    orderBy: { displayName: "asc" },
  });
}
```

- [ ] **Step 5: Run the tests + type-check**

Run: `pnpm --filter @workspace/contacts exec vitest run src/data-models/contact-repo.test.ts`
Expected: PASS (including the pre-existing `listContactsForOrg` tests — the refactor preserves behavior).
Run: `pnpm --filter @workspace/contacts type-check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contacts/src/schemas/contact-schemas.ts \
        packages/contacts/src/data-models/contact-repo.ts \
        packages/contacts/src/data-models/contact-repo.test.ts
git commit -m "feat(contacts): shared list where/include + count + listContactsByIds"
```

---

### Task 2: Segment filter schema v2 (+ bump version, update app helper)

**Files:**
- Modify: `packages/contacts/src/schemas/segment-schemas.ts`
- Modify: `apps/dashboard/features/contacts/contact-segment/data/contact-segment-filters.ts`
- Test: `packages/contacts/src/schemas/segment-schemas.test.ts` (create)

> Bumping `CURRENT_FILTER_VERSION` and the `CreateContactSegmentSchema` literal would break the app's `buildCreateSegmentInput` (which hardcodes `filterVersion: 1`). Both are changed in this single commit to keep the workspace type-checking.

- [ ] **Step 1: Write the failing schema test**

Create `packages/contacts/src/schemas/segment-schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CURRENT_FILTER_VERSION,
  ContactSegmentFilterSchemaV2,
} from "./segment-schemas";

describe("segment filter schema v2", () => {
  it("CURRENT_FILTER_VERSION is 2", () => {
    expect(CURRENT_FILTER_VERSION).toBe(2);
  });

  it("accepts contactIds", () => {
    const parsed = ContactSegmentFilterSchemaV2.parse({
      search: "x",
      contactIds: ["a", "b"],
    });
    expect(parsed.contactIds).toEqual(["a", "b"]);
  });

  it("rejects unknown keys", () => {
    expect(() => ContactSegmentFilterSchemaV2.parse({ bogus: 1 })).toThrow();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @workspace/contacts exec vitest run src/schemas/segment-schemas.test.ts`
Expected: FAIL — `CURRENT_FILTER_VERSION` is `1`, and `ContactSegmentFilterSchemaV2` is not exported.

- [ ] **Step 3: Implement v2 in `segment-schemas.ts`**

Replace the whole file with:

```ts
import { z } from "zod";

export const CURRENT_FILTER_VERSION = 2;

export const ContactSegmentFilterSchemaV1 = z
  .object({
    search: z.string().optional(),
    kind: z.enum(["person", "company"]).optional(),
    stageId: z.string().optional(),
    tagIds: z.array(z.string()).optional(),
    includeArchived: z.boolean().optional(),
  })
  .strict();

export type ContactSegmentFilterV1 = z.infer<typeof ContactSegmentFilterSchemaV1>;

// v2 = all v1 dynamic fields + explicit membership IDs.
export const ContactSegmentFilterSchemaV2 = z
  .object({
    search: z.string().optional(),
    kind: z.enum(["person", "company"]).optional(),
    stageId: z.string().optional(),
    tagIds: z.array(z.string()).optional(),
    includeArchived: z.boolean().optional(),
    contactIds: z.array(z.string()).optional(),
  })
  .strict();

export type ContactSegmentFilterV2 = z.infer<typeof ContactSegmentFilterSchemaV2>;

export const CreateContactSegmentSchema = z.object({
  name: z.string().min(1).max(255),
  filters: ContactSegmentFilterSchemaV2,
  filterVersion: z.literal(CURRENT_FILTER_VERSION),
  sortKey: z.string().default("displayName"),
  sortDirection: z.enum(["asc", "desc"]).default("asc"),
});

export const UpdateContactSegmentSchema = CreateContactSegmentSchema.partial();

export type CreateContactSegmentInput = z.infer<typeof CreateContactSegmentSchema>;
export type UpdateContactSegmentInput = z.infer<typeof UpdateContactSegmentSchema>;
```

- [ ] **Step 4: Update the app helper to v2**

In `apps/dashboard/features/contacts/contact-segment/data/contact-segment-filters.ts`, import the version constant and use it instead of the hardcoded `1`:

```ts
import type { ContactListFilters } from "@workspace/contacts/schemas/contact-schemas";
import type {
  ContactSegmentFilterV1,
  CreateContactSegmentInput,
} from "@workspace/contacts/schemas/segment-schemas";
import { CURRENT_FILTER_VERSION } from "@workspace/contacts/schemas/segment-schemas";

export function contactListFiltersToSegmentFilters(
  filters: Partial<ContactListFilters>,
): ContactSegmentFilterV1 {
  return {
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.stageId ? { stageId: filters.stageId } : {}),
    ...(filters.tagIds?.length ? { tagIds: filters.tagIds } : {}),
    ...(filters.includeArchived ? { includeArchived: true } : {}),
  };
}

export function buildCreateSegmentInput(
  name: string,
  filters: Partial<ContactListFilters>,
): CreateContactSegmentInput {
  return {
    name: name.trim(),
    filters: contactListFiltersToSegmentFilters(filters),
    filterVersion: CURRENT_FILTER_VERSION,
    sortKey: "displayName",
    sortDirection: "asc",
  };
}
```

(`contactListFiltersToSegmentFilters` returns a `V1`-shaped object, which is assignable to the `filters: V2` field because `contactIds` is optional.)

- [ ] **Step 5: Run schema test + type-check**

Run: `pnpm --filter @workspace/contacts exec vitest run src/schemas/segment-schemas.test.ts`
Expected: PASS.
Run: `pnpm --filter @workspace/contacts type-check && pnpm --filter dashboard type-check`
Expected: PASS (the literal-2 change and helper update are consistent).

- [ ] **Step 6: Commit**

```bash
git add packages/contacts/src/schemas/segment-schemas.ts \
        packages/contacts/src/schemas/segment-schemas.test.ts \
        apps/dashboard/features/contacts/contact-segment/data/contact-segment-filters.ts
git commit -m "feat(contacts): add segment filter v2 with explicit contactIds"
```

---

### Task 3: Segment service — accept v2 + OR membership semantics

**Files:**
- Modify: `packages/contacts/src/services/segment-service.ts`
- Test: `packages/contacts/src/services/segment-service.test.ts` (extend existing)

- [ ] **Step 1: Write failing tests**

Add to `segment-service.test.ts`. Ensure the imports include the new `buildSegmentMembershipWhere` and that `validateSegmentFilters`, `buildContactWhereFromSegment`, `countContactsForSegment` are imported from `./segment-service`. The existing file already does `vi.mock("../data-models/contact-segment-repo", ...)` exposing `getContactSegmentById` and `vi.mock("@workspace/database", ...)`. Confirm the database mock includes `contact: { count: vi.fn(), findMany: vi.fn() }`.

```ts
import {
  validateSegmentFilters,
  buildContactWhereFromSegment,
  buildSegmentMembershipWhere,
  countContactsForSegment,
} from "./segment-service";

describe("validateSegmentFilters", () => {
  it("accepts version 1", () => {
    expect(validateSegmentFilters({ search: "a" }, 1)).toEqual({ search: "a" });
  });
  it("accepts version 2 with contactIds", () => {
    expect(validateSegmentFilters({ contactIds: ["c1"] }, 2)).toEqual({ contactIds: ["c1"] });
  });
  it("throws for unsupported versions", () => {
    expect(() => validateSegmentFilters({}, 3)).toThrow(/Unsupported/);
  });
});

describe("buildSegmentMembershipWhere", () => {
  it("returns the dynamic where when no contactIds are present", () => {
    const where = buildSegmentMembershipWhere("org_1", { kind: "person" });
    expect(where).toEqual(buildContactWhereFromSegment("org_1", { kind: "person" }));
  });

  it("ORs dynamic filters with explicit contactIds", () => {
    const where = buildSegmentMembershipWhere("org_1", {
      kind: "person",
      contactIds: ["c1", "c2"],
    });
    expect(where).toEqual({
      organizationId: "org_1",
      OR: [
        buildContactWhereFromSegment("org_1", { kind: "person", contactIds: ["c1", "c2"] }),
        { id: { in: ["c1", "c2"] } },
      ],
    });
  });
});

describe("countContactsForSegment (v2)", () => {
  it("uses OR membership semantics for v2 segments with contactIds", async () => {
    vi.mocked(getContactSegmentById).mockResolvedValue({
      id: "seg_1",
      organizationId: "org_1",
      filterVersion: 2,
      filters: { contactIds: ["c1"] },
      sortKey: "displayName",
      sortDirection: "asc",
    } as never);
    vi.mocked(prisma.contact.count).mockResolvedValue(5 as never);

    await countContactsForSegment("org_1", "seg_1");

    const where = vi.mocked(prisma.contact.count).mock.calls[0]?.[0]?.where;
    expect(where).toEqual(buildSegmentMembershipWhere("org_1", { contactIds: ["c1"] }));
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @workspace/contacts exec vitest run src/services/segment-service.test.ts`
Expected: FAIL — `buildSegmentMembershipWhere` not exported; `validateSegmentFilters` rejects version 2; count uses the old where.

- [ ] **Step 3: Implement v2 in `segment-service.ts`**

Update the imports and the three functions. Change the `validateSegmentFilters` return type and `buildContactWhereFromSegment` parameter to `ContactSegmentFilterV2`, add `buildSegmentMembershipWhere`, and switch `countContactsForSegment` / `listContactsForSegment` to use it.

Imports at the top of the file:

```ts
import { prisma } from "@workspace/database";
import type { Prisma } from "@workspace/database";
import { getContactSegmentById } from "../data-models/contact-segment-repo";
import {
  ContactSegmentFilterSchemaV1,
  ContactSegmentFilterSchemaV2,
  type ContactSegmentFilterV2,
} from "../schemas/segment-schemas";
```

`validateSegmentFilters`:

```ts
export function validateSegmentFilters(
  filters: unknown,
  filterVersion: number,
): ContactSegmentFilterV2 {
  if (filterVersion === 1) {
    return ContactSegmentFilterSchemaV1.parse(filters);
  }
  if (filterVersion === 2) {
    return ContactSegmentFilterSchemaV2.parse(filters);
  }
  throw new Error(`Unsupported filter version: ${filterVersion}`);
}
```

`buildContactWhereFromSegment` — change the parameter type to `ContactSegmentFilterV2`; the body (search/kind/stage/tags AND semantics, includeArchived) is unchanged and simply ignores `contactIds`:

```ts
export function buildContactWhereFromSegment(
  organizationId: string,
  filters: ContactSegmentFilterV2,
): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = { organizationId };

  if (!filters.includeArchived) {
    where.archivedAt = null;
  }
  if (filters.kind) {
    where.kind = filters.kind;
  }
  if (filters.stageId) {
    where.stageId = filters.stageId;
  }
  if (filters.search) {
    where.OR = [
      { displayName: { contains: filters.search, mode: "insensitive" } },
      { primaryEmail: { contains: filters.search, mode: "insensitive" } },
    ];
  }
  if (filters.tagIds && filters.tagIds.length > 0) {
    where.AND = filters.tagIds.map((tagId) => ({
      tags: { some: { tagId } },
    }));
  }

  return where;
}
```

Add `buildSegmentMembershipWhere` immediately after it:

```ts
// A contact belongs to a segment if it matches the dynamic filters OR is one of
// the explicit contactIds. v1 segments (no contactIds) behave exactly as before.
export function buildSegmentMembershipWhere(
  organizationId: string,
  filters: ContactSegmentFilterV2,
): Prisma.ContactWhereInput {
  const dynamicWhere = buildContactWhereFromSegment(organizationId, filters);
  const contactIds = filters.contactIds ?? [];
  if (contactIds.length === 0) {
    return dynamicWhere;
  }
  return {
    organizationId,
    OR: [dynamicWhere, { id: { in: contactIds } }],
  };
}
```

**Add** `countContactsForSegment` (it does not exist at `HEAD`) immediately before `listContactsForSegment`, using the membership where:

```ts
export async function countContactsForSegment(
  organizationId: string,
  segmentId: string,
): Promise<number> {
  const segment = await getContactSegmentById(segmentId, organizationId);
  if (!segment) {
    throw new Error("Segment not found in this organization");
  }

  const filters = validateSegmentFilters(segment.filters, segment.filterVersion);

  return prisma.contact.count({
    where: buildSegmentMembershipWhere(organizationId, filters),
  });
}
```

In the existing `listContactsForSegment`, replace the `where` in `prisma.contact.findMany` with `buildSegmentMembershipWhere(organizationId, filters)` (leave `include`, `orderBy`, `take`, `skip` unchanged).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @workspace/contacts exec vitest run src/services/segment-service.test.ts`
Expected: PASS (including any pre-existing v1 tests — v1 segments still produce the same where since `contactIds` is empty).

- [ ] **Step 5: Commit**

```bash
git add packages/contacts/src/services/segment-service.ts \
        packages/contacts/src/services/segment-service.test.ts
git commit -m "feat(contacts): segment membership honors explicit contactIds (v2 OR semantics)"
```

---

### Task 4: `addContactsToSegment` service function

**Files:**
- Modify: `packages/contacts/src/services/segment-service.ts`
- Modify: `packages/contacts/src/data-models/contact-segment-repo.ts` (no code change — already exports `updateContactSegment`; verify only)
- Test: `packages/contacts/src/services/segment-service.test.ts` (extend)

- [ ] **Step 1: Write failing tests**

Add to `segment-service.test.ts`. This needs two more mocked dependencies: `updateContactSegment` (extend the existing `contact-segment-repo` mock) and `listContactsByIds` (new mock of `../data-models/contact-repo`). Update the mock factories near the top of the file:

```ts
vi.mock("../data-models/contact-segment-repo", () => ({
  getContactSegmentById: vi.fn(),
  updateContactSegment: vi.fn(),
}));

vi.mock("../data-models/contact-repo", () => ({
  listContactsByIds: vi.fn(),
}));
```

Then add the tests (import `addContactsToSegment` from `./segment-service`, `getContactSegmentById` + `updateContactSegment` from `../data-models/contact-segment-repo`, `listContactsByIds` from `../data-models/contact-repo`):

```ts
import { addContactsToSegment } from "./segment-service";
import {
  getContactSegmentById,
  updateContactSegment,
} from "../data-models/contact-segment-repo";
import { listContactsByIds } from "../data-models/contact-repo";

describe("addContactsToSegment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("merges new ids, dedupes, upgrades v1 to v2, and reports added count", async () => {
    vi.mocked(getContactSegmentById).mockResolvedValue({
      id: "seg_1",
      organizationId: "org_1",
      filterVersion: 1,
      filters: { search: "x" },
      sortKey: "displayName",
      sortDirection: "asc",
    } as never);
    vi.mocked(listContactsByIds).mockResolvedValue([{ id: "c1" }, { id: "c2" }] as never);
    vi.mocked(updateContactSegment).mockResolvedValue({} as never);

    const result = await addContactsToSegment("org_1", "seg_1", ["c1", "c2"]);

    expect(updateContactSegment).toHaveBeenCalledWith("seg_1", "org_1", {
      filters: { search: "x", contactIds: ["c1", "c2"] },
    });
    expect(result).toEqual({ addedCount: 2, totalExplicitIds: 2 });
  });

  it("fails the whole merge when an id is missing in the org", async () => {
    vi.mocked(getContactSegmentById).mockResolvedValue({
      id: "seg_1",
      organizationId: "org_1",
      filterVersion: 1,
      filters: {},
      sortKey: "displayName",
      sortDirection: "asc",
    } as never);
    vi.mocked(listContactsByIds).mockResolvedValue([{ id: "c1" }] as never);

    await expect(
      addContactsToSegment("org_1", "seg_1", ["c1", "missing"]),
    ).rejects.toThrow();
    expect(updateContactSegment).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @workspace/contacts exec vitest run src/services/segment-service.test.ts`
Expected: FAIL — `addContactsToSegment` not exported.

- [ ] **Step 3: Implement `addContactsToSegment`**

Add to the imports in `segment-service.ts`:

```ts
import { listContactsByIds } from "../data-models/contact-repo";
import { updateContactSegment } from "../data-models/contact-segment-repo";
```

(The file already imports `getContactSegmentById` from `../data-models/contact-segment-repo`; extend that line to also import `updateContactSegment`.)

Add the function at the end of the file:

```ts
export async function addContactsToSegment(
  organizationId: string,
  segmentId: string,
  contactIds: string[],
): Promise<{ addedCount: number; totalExplicitIds: number }> {
  if (contactIds.length === 0) {
    throw new Error("No contacts provided");
  }

  const segment = await getContactSegmentById(segmentId, organizationId);
  if (!segment) {
    throw new Error("Segment not found in this organization");
  }

  // Fail loudly if any id is not a live contact in this org (no silent partial add).
  const found = await listContactsByIds(organizationId, contactIds);
  if (found.length !== contactIds.length) {
    throw new Error("One or more contacts were not found in this organization");
  }

  const filters = validateSegmentFilters(segment.filters, segment.filterVersion);
  const existing = filters.contactIds ?? [];
  const merged = Array.from(new Set([...existing, ...contactIds]));

  // updateContactSegment bumps filterVersion to CURRENT_FILTER_VERSION (2) when filters change.
  await updateContactSegment(segmentId, organizationId, {
    filters: { ...filters, contactIds: merged },
  });

  return {
    addedCount: merged.length - existing.length,
    totalExplicitIds: merged.length,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @workspace/contacts exec vitest run src/services/segment-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Full domain package test + type-check**

Run: `pnpm test --filter @workspace/contacts && pnpm --filter @workspace/contacts type-check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contacts/src/services/segment-service.ts \
        packages/contacts/src/services/segment-service.test.ts
git commit -m "feat(contacts): add addContactsToSegment with org validation + dedupe merge"
```

---

# Phase 2 — Server actions (`apps/dashboard`)

### Task 5: `exportContactsByIdsAction`

**Files:**
- Modify: `apps/dashboard/features/contacts/contact/data/contact-csv-actions.ts`
- Test: `apps/dashboard/features/contacts/contact/data/contact-csv-actions.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `contact-csv-actions.test.ts`. The `@workspace/contacts` mock must include **every** name the action file imports (so module evaluation doesn't blow up); mirror the file's import list and add `listContactsByIds`.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrgPermissionWithActiveOrg } from "@workspace/auth/guards";
import { exportContactsByIdsAction } from "./contact-csv-actions";

vi.mock("@workspace/auth/guards", () => ({
  requireOrgPermissionWithActiveOrg: vi.fn().mockResolvedValue({
    session: { user: { id: "user_1" } },
    activeOrganizationId: "org_1",
  }),
}));

vi.mock("@workspace/contacts", () => ({
  listContactsByIds: vi.fn(),
  listContactsForOrg: vi.fn(),
  listContactsForSegment: vi.fn(),
  exportContactsToCsv: vi.fn().mockReturnValue("csv-data"),
  formatContactTagsForCsv: vi.fn().mockReturnValue(""),
  parseContactsCsv: vi.fn(),
  createContact: vi.fn(),
  parseTagNamesFromCsv: vi.fn().mockReturnValue([]),
  setContactTags: vi.fn(),
}));

import { listContactsByIds } from "@workspace/contacts";

describe("exportContactsByIdsAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires contact export permission", async () => {
    vi.mocked(listContactsByIds).mockResolvedValue([
      { id: "c1", displayName: "A", kind: "person", tags: [] },
    ] as never);
    await exportContactsByIdsAction(["c1"]);
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenCalledWith({ contact: ["export"] });
  });

  it("fails when fewer contacts are found than requested", async () => {
    vi.mocked(listContactsByIds).mockResolvedValue([] as never);
    const result = await exportContactsByIdsAction(["c1", "c2"]);
    expect(result.success).toBe(false);
  });

  it("rejects more than 1000 ids without querying", async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `c${i}`);
    const result = await exportContactsByIdsAction(ids);
    expect(result.success).toBe(false);
    expect(listContactsByIds).not.toHaveBeenCalled();
  });
});
```

> Verify the `@workspace/contacts` mock keys match the actual imports at the top of `contact-csv-actions.ts` (open the file). Add/remove keys so every imported name is present as a `vi.fn()`. Missing keys cause `undefined is not a function` at import time.

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter dashboard exec vitest run features/contacts/contact/data/contact-csv-actions.test.ts`
Expected: FAIL — `exportContactsByIdsAction` is not exported.

- [ ] **Step 3: Implement the action**

Add `listContactsByIds` to the `@workspace/contacts` import in `contact-csv-actions.ts`, then add at the end of the file:

```ts
const MAX_EXPORT_IDS = 1000;

export async function exportContactsByIdsAction(
  contactIds: string[],
): Promise<ActionResult<string>> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      contact: ["export"],
    });

    if (contactIds.length === 0) {
      return { success: false, error: "No contacts selected" };
    }
    if (contactIds.length > MAX_EXPORT_IDS) {
      return {
        success: false,
        error: `Cannot export more than ${MAX_EXPORT_IDS} contacts at once`,
      };
    }

    const contacts = await listContactsByIds(activeOrganizationId, contactIds);
    if (contacts.length !== contactIds.length) {
      return { success: false, error: "Some selected contacts could not be found" };
    }

    const csv = exportContactsToCsv(
      contacts.map((c) => ({
        displayName: c.displayName,
        kind: c.kind as "person" | "company",
        firstName: c.firstName ?? undefined,
        lastName: c.lastName ?? undefined,
        companyName: c.companyName ?? undefined,
        primaryEmail: c.primaryEmail ?? undefined,
        primaryPhone: c.primaryPhone ?? undefined,
        website: c.website ?? undefined,
        source: c.source ?? undefined,
        tags: formatContactTagsForCsv(c.tags),
      })),
    );
    return { success: true, data: csv };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Export failed" };
  }
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter dashboard exec vitest run features/contacts/contact/data/contact-csv-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/features/contacts/contact/data/contact-csv-actions.ts \
        apps/dashboard/features/contacts/contact/data/contact-csv-actions.test.ts
git commit -m "feat(contacts): add exportContactsByIdsAction (selected CSV export)"
```

---

### Task 6: `addContactsToSegmentAction`

**Files:**
- Modify: `apps/dashboard/features/contacts/contact-segment/data/contact-segment-actions.ts`
- Test: `apps/dashboard/features/contacts/contact-segment/data/contact-segment-actions.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `contact-segment-actions.test.ts`. The `@workspace/contacts` mock must include every name the actions file imports (mirror the file). Include `countContactsForSegment` now (it gets imported in Task 7) so the mock survives both tasks.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrgPermissionWithActiveOrg } from "@workspace/auth/guards";
import { addContactsToSegmentAction } from "./contact-segment-actions";

vi.mock("@workspace/auth/guards", () => ({
  requireOrgPermissionWithActiveOrg: vi.fn().mockResolvedValue({
    session: { user: { id: "user_1" } },
    activeOrganizationId: "org_1",
  }),
}));

vi.mock("@workspace/contacts", () => ({
  listContactSegmentsForOrg: vi.fn(),
  createContactSegment: vi.fn(),
  deleteContactSegment: vi.fn(),
  listContactsForSegment: vi.fn(),
  countContactsForSegment: vi.fn(),
  addContactsToSegment: vi.fn().mockResolvedValue({ addedCount: 2, totalExplicitIds: 2 }),
}));

import { addContactsToSegment } from "@workspace/contacts";

describe("addContactsToSegmentAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires contactSettings update permission and delegates ids to the service", async () => {
    const result = await addContactsToSegmentAction("seg_1", ["c1", "c2"]);
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenCalledWith({
      contactSettings: ["update"],
    });
    expect(addContactsToSegment).toHaveBeenCalledWith("org_1", "seg_1", ["c1", "c2"]);
    expect(result).toEqual({ success: true, data: { addedCount: 2, totalExplicitIds: 2 } });
  });

  it("rejects an empty selection without calling the service", async () => {
    const result = await addContactsToSegmentAction("seg_1", []);
    expect(result.success).toBe(false);
    expect(addContactsToSegment).not.toHaveBeenCalled();
  });
});
```

> Open `contact-segment-actions.ts` and confirm the mock keys cover its `@workspace/contacts` imports.

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter dashboard exec vitest run features/contacts/contact-segment/data/contact-segment-actions.test.ts`
Expected: FAIL — `addContactsToSegmentAction` not exported.

- [ ] **Step 3: Implement the action**

Add `addContactsToSegment` to the `@workspace/contacts` import in `contact-segment-actions.ts`, then add:

```ts
const MAX_SEGMENT_ADD_IDS = 1000;

export async function addContactsToSegmentAction(
  segmentId: string,
  contactIds: string[],
): Promise<ActionResult<{ addedCount: number; totalExplicitIds: number }>> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      contactSettings: ["update"],
    });

    if (contactIds.length === 0) {
      return { success: false, error: "No contacts selected" };
    }
    if (contactIds.length > MAX_SEGMENT_ADD_IDS) {
      return {
        success: false,
        error: `Cannot add more than ${MAX_SEGMENT_ADD_IDS} contacts at once`,
      };
    }

    const data = await addContactsToSegment(activeOrganizationId, segmentId, contactIds);
    return { success: true, data };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to add contacts to segment",
    };
  }
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter dashboard exec vitest run features/contacts/contact-segment/data/contact-segment-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/features/contacts/contact-segment/data/contact-segment-actions.ts \
        apps/dashboard/features/contacts/contact-segment/data/contact-segment-actions.test.ts
git commit -m "feat(contacts): add addContactsToSegmentAction"
```

---

### Task 7: List actions return `{ rows, totalCount }`

**Files:**
- Modify: `apps/dashboard/features/contacts/contact/data/contact-actions.ts`
- Modify: `apps/dashboard/features/contacts/contact-segment/data/contact-segment-actions.ts`
- Modify: `apps/dashboard/features/contacts/contact/ui/contacts-page-content.tsx` (minimal consumer fix — fully refactored in Task 16)
- Test: `apps/dashboard/features/contacts/contact/data/contact-actions.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Add to `contact-actions.test.ts`. Add `countContactsMatchingListFilters` to the existing `@workspace/contacts` mock factory (`countContactsMatchingListFilters: vi.fn().mockResolvedValue(0)`), then:

```ts
import { listContactsForOrg, countContactsMatchingListFilters } from "@workspace/contacts";

describe("listContactsAction shape", () => {
  it("returns rows and totalCount", async () => {
    vi.mocked(listContactsForOrg).mockResolvedValue([{ id: "c1" }] as never);
    vi.mocked(countContactsMatchingListFilters).mockResolvedValue(1 as never);
    const result = await listContactsAction();
    expect(result).toEqual({
      success: true,
      data: { rows: [{ id: "c1" }], totalCount: 1 },
    });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter dashboard exec vitest run features/contacts/contact/data/contact-actions.test.ts`
Expected: FAIL — `listContactsAction` currently returns the bare array.

- [ ] **Step 3: Update `listContactsAction`**

In `contact-actions.ts`, add `countContactsMatchingListFilters` to the `@workspace/contacts` import and replace `listContactsAction`:

```ts
export async function listContactsAction(
  filters: Partial<ContactListFilters> = {},
): Promise<
  ActionResult<{
    rows: Awaited<ReturnType<typeof listContactsForOrg>>;
    totalCount: number;
  }>
> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      contact: ["read"],
    });
    const [rows, totalCount] = await Promise.all([
      listContactsForOrg(activeOrganizationId, filters),
      countContactsMatchingListFilters(activeOrganizationId, filters),
    ]);
    return { success: true, data: { rows, totalCount } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load contacts",
    };
  }
}
```

- [ ] **Step 4: Update `listContactsForSegmentAction`**

In `contact-segment-actions.ts`, add `countContactsForSegment` to the `@workspace/contacts` import and replace `listContactsForSegmentAction`:

```ts
export async function listContactsForSegmentAction(
  segmentId: string,
  options: { page?: number; pageSize?: number } = {},
): Promise<
  ActionResult<{
    rows: Awaited<ReturnType<typeof listContactsForSegment>>;
    totalCount: number;
  }>
> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      contact: ["read"],
    });
    const [rows, totalCount] = await Promise.all([
      listContactsForSegment(activeOrganizationId, segmentId, options),
      countContactsForSegment(activeOrganizationId, segmentId),
    ]);
    return { success: true, data: { rows, totalCount } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load segment contacts",
    };
  }
}
```

- [ ] **Step 5: Minimal consumer fix in `contacts-page-content.tsx`**

Keep the page compiling until Task 16 rewrites it. Two edits:

Change the `Contact` type derivation (around line 62) to read `rows`:

```ts
type Contact = NonNullable<
  Extract<Awaited<ReturnType<typeof listContactsAction>>, { success: true }>["data"]
>["rows"][number];
```

In `load` (around line 136), set rows instead of the bare data:

```ts
      if (result.success && gen === loadGenRef.current) {
        setContacts(result.data.rows);
      }
```

- [ ] **Step 6: Run tests + type-check**

Run: `pnpm --filter dashboard exec vitest run features/contacts/contact/data/contact-actions.test.ts`
Expected: PASS.
Run: `pnpm --filter dashboard type-check`
Expected: PASS. If `contact-domain-permissions.test.ts` or other callers break on the new shape, update them to read `result.data.rows`.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/features/contacts/contact/data/contact-actions.ts \
        apps/dashboard/features/contacts/contact/data/contact-actions.test.ts \
        apps/dashboard/features/contacts/contact-segment/data/contact-segment-actions.ts \
        apps/dashboard/features/contacts/contact/ui/contacts-page-content.tsx
git commit -m "feat(contacts): list actions return { rows, totalCount } for server pagination"
```

---

# Phase 3 — Shared UI primitives (`packages/ui`)

### Task 8: `getDataTableSelectedRowCount` + fix bulk bar count

**Files:**
- Modify: `packages/ui/src/components/data-table.tsx`
- Test: `packages/ui/src/components/data-table.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/components/data-table.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import type { Table } from "@tanstack/react-table"
import { getDataTableSelectedRowCount } from "#components/data-table"

function tableWithSelection(rowSelection: Record<string, boolean>) {
  return { getState: () => ({ rowSelection }) } as unknown as Table<unknown>
}

describe("getDataTableSelectedRowCount", () => {
  it("counts only truthy selection entries (across pages)", () => {
    expect(
      getDataTableSelectedRowCount(tableWithSelection({ a: true, b: false, c: true })),
    ).toBe(2)
  })

  it("returns 0 when nothing is selected", () => {
    expect(getDataTableSelectedRowCount(tableWithSelection({}))).toBe(0)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @workspace/ui exec vitest run src/components/data-table.test.tsx`
Expected: FAIL — `getDataTableSelectedRowCount` is not exported.

- [ ] **Step 3: Implement the helper and use it in the bulk bar**

In `data-table.tsx`, add the helper (near the top-level function declarations, before `DataTableBulkActions`):

```tsx
export function getDataTableSelectedRowCount<TData>(
  table: TanStackTable<TData>,
): number {
  const rowSelection = table.getState().rowSelection
  return Object.values(rowSelection).filter(Boolean).length
}
```

In `DataTableBulkActions`, replace the count and the deselect handler so they reflect cross-page selection under manual pagination:

```tsx
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-mr-4 text-sm"
        title="Deselect all"
        onClick={() => table.resetRowSelection()}
      >
        <span className="text-sm font-semibold">
          {getDataTableSelectedRowCount(table)} selected
        </span>
        <XIcon className="ml-2 size-4" aria-hidden="true" />
      </Button>
```

Add `getDataTableSelectedRowCount` to the file's `export { ... }` block at the bottom.

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @workspace/ui exec vitest run src/components/data-table.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/data-table.tsx \
        packages/ui/src/components/data-table.test.tsx
git commit -m "feat(ui): cross-page selected row count for DataTableBulkActions"
```

---

### Task 9: `createDataTableSelectColumn`

**Files:**
- Create: `packages/ui/src/components/data-table-select-column.tsx`
- Test: `packages/ui/src/components/data-table-select-column.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/components/data-table-select-column.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { createDataTableSelectColumn } from "#components/data-table-select-column"

describe("createDataTableSelectColumn", () => {
  it("returns a non-sortable, non-hideable select column", () => {
    const col = createDataTableSelectColumn()
    expect(col.id).toBe("select")
    expect(col.enableSorting).toBe(false)
    expect(col.enableHiding).toBe(false)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @workspace/ui exec vitest run src/components/data-table-select-column.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the column factory**

Create `packages/ui/src/components/data-table-select-column.tsx`:

```tsx
"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Checkbox } from "#components/checkbox"

/**
 * Reusable TanStack select column. Header toggles the current page; cell toggles
 * a single row. Both stop click propagation so a row's onRowClicked navigation
 * does not fire when toggling selection.
 */
export function createDataTableSelectColumn<TData>(): ColumnDef<TData> {
  return {
    id: "select",
    enableSorting: false,
    enableHiding: false,
    header: ({ table }) => (
      <Checkbox
        aria-label="Select all rows on this page"
        checked={
          table.getIsAllPageRowsSelected()
            ? true
            : table.getIsSomePageRowsSelected()
              ? "indeterminate"
              : false
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        onClick={(event) => event.stopPropagation()}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label="Select row"
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        onClick={(event) => event.stopPropagation()}
      />
    ),
  }
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @workspace/ui exec vitest run src/components/data-table-select-column.test.tsx`
Expected: PASS.

- [ ] **Step 5: type-check + commit**

Run: `pnpm --filter @workspace/ui type-check`
Expected: PASS.

```bash
git add packages/ui/src/components/data-table-select-column.tsx \
        packages/ui/src/components/data-table-select-column.test.tsx
git commit -m "feat(ui): add createDataTableSelectColumn helper"
```

---

# Phase 4 — Contacts list UI (`apps/dashboard`)

> Component dependency order (build in this order so each file type-checks on creation):
> data-table → mobile-list → icons → modal → bulk-actions → list → page-content.
> The shared `Contact` type and `ContactRowActions` live in `contacts-data-table.tsx`; other components import them. There are no value import cycles (cross-file references to `Contact` are type-only).

### Task 10: `contacts-data-table.tsx` (columns, row actions, desktop view)

**Files:**
- Create: `apps/dashboard/features/contacts/contact/ui/contacts-data-table.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";

import type { ColumnDef, Row, Table as TanStackTable } from "@tanstack/react-table";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { DataTable } from "@workspace/ui/components/data-table";
import { createDataTableSelectColumn } from "@workspace/ui/components/data-table-select-column";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { StageView } from "@workspace/ui/components/entity-label-views";
import { TagListCompact } from "@workspace/ui/components/tag-list-compact";
import { IconForMore } from "@workspace/ui/components/icon-for";
import { listContactsAction } from "../data/contact-actions";

// Single source of truth for the row type, derived from the list action.
export type Contact = NonNullable<
  Extract<Awaited<ReturnType<typeof listContactsAction>>, { success: true }>["data"]
>["rows"][number];

// Navigation + archive handlers are passed via the table meta so columns stay static.
export type ContactTableMeta = {
  onView: (id: string) => void;
  onArchive: (id: string) => void;
};

export function ContactRowActions({
  onArchive,
  onView,
}: {
  onArchive: () => void;
  onView: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" onClick={(e) => e.stopPropagation()}>
          <IconForMore />
          <span className="sr-only">Actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onView}>View</DropdownMenuItem>
        <DropdownMenuItem className="text-destructive" onClick={onArchive}>
          Archive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function createContactColumns(): ColumnDef<Contact>[] {
  return [
    createDataTableSelectColumn<Contact>(),
    {
      accessorKey: "displayName",
      header: "Name",
      enableHiding: false,
      cell: ({ row }) => (
        <span className="block max-w-[12rem] truncate font-medium">
          {row.original.displayName}
        </span>
      ),
    },
    {
      accessorKey: "kind",
      header: "Kind",
      enableSorting: false,
      cell: ({ row }) => <Badge variant="outline">{row.original.kind}</Badge>,
    },
    {
      accessorKey: "primaryEmail",
      header: "Email",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="block max-w-[240px] truncate text-muted-foreground">
          {row.original.primaryEmail ?? "—"}
        </span>
      ),
    },
    {
      id: "stage",
      header: "Stage",
      enableSorting: false,
      cell: ({ row }) =>
        row.original.stage ? (
          <StageView name={row.original.stage.name} color={row.original.stage.color} />
        ) : (
          "—"
        ),
    },
    {
      id: "tags",
      header: "Tags",
      enableSorting: false,
      cell: ({ row }) => (
        <TagListCompact
          tags={row.original.tags.map((a) => ({
            id: a.tagId,
            name: a.tag.name,
            color: a.tag.color,
          }))}
        />
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row, table }) => {
        const meta = table.options.meta as ContactTableMeta;
        return (
          <div onClick={(e) => e.stopPropagation()}>
            <ContactRowActions
              onView={() => meta.onView(row.original.id)}
              onArchive={() => meta.onArchive(row.original.id)}
            />
          </div>
        );
      },
    },
  ];
}

export function ContactsDataTable({
  table,
  isPending,
}: {
  table: TanStackTable<Contact>;
  isPending: boolean;
}) {
  const meta = table.options.meta as ContactTableMeta;
  return (
    <div className="rounded-md border">
      <DataTable
        table={table}
        onRowClicked={(row: Row<Contact>) => meta.onView(row.original.id)}
        emptyState={
          <span className="text-muted-foreground">
            {isPending ? "Loading…" : "No contacts match these filters."}
          </span>
        }
      />
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter dashboard type-check`
Expected: PASS. (Imports `createDataTableSelectColumn` from Task 9 and `listContactsAction` with the new `{ rows, totalCount }` shape from Task 7.)

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/features/contacts/contact/ui/contacts-data-table.tsx
git commit -m "feat(contacts): add contacts desktop data table with select column"
```

---

### Task 11: `contacts-mobile-list.tsx`

**Files:**
- Create: `apps/dashboard/features/contacts/contact/ui/contacts-mobile-list.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";

import type { Table as TanStackTable } from "@tanstack/react-table";
import { Badge } from "@workspace/ui/components/badge";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { StageView } from "@workspace/ui/components/entity-label-views";
import {
  DataList,
  DataListCard,
  DataListCardHeader,
  DataListCardMeta,
} from "@workspace/ui/components/responsive-data-view";
import { TagListCompact } from "@workspace/ui/components/tag-list-compact";
import {
  ContactRowActions,
  type Contact,
  type ContactTableMeta,
} from "./contacts-data-table";

export function ContactsMobileList({
  table,
  isPending,
}: {
  table: TanStackTable<Contact>;
  isPending: boolean;
}) {
  const meta = table.options.meta as ContactTableMeta;
  const rows = table.getRowModel().rows;

  if (isPending) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No contacts match these filters.
      </p>
    );
  }

  return (
    <DataList>
      {rows.map((row) => {
        const c = row.original;
        return (
          <DataListCard key={c.id} onActivate={() => meta.onView(c.id)}>
            <div className="flex items-start gap-3">
              <Checkbox
                aria-label="Select contact"
                className="mt-1"
                checked={row.getIsSelected()}
                onCheckedChange={(value) => row.toggleSelected(!!value)}
                onClick={(e) => e.stopPropagation()}
              />
              <div className="min-w-0 flex-1 space-y-1.5">
                <DataListCardHeader
                  actions={
                    <ContactRowActions
                      onView={() => meta.onView(c.id)}
                      onArchive={() => meta.onArchive(c.id)}
                    />
                  }
                >
                  {c.displayName}
                </DataListCardHeader>
                {c.primaryEmail ? (
                  <DataListCardMeta>{c.primaryEmail}</DataListCardMeta>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{c.kind}</Badge>
                  {c.stage ? (
                    <StageView name={c.stage.name} color={c.stage.color} size="sm" />
                  ) : null}
                </div>
                <TagListCompact
                  tags={c.tags.map((a) => ({
                    id: a.tagId,
                    name: a.tag.name,
                    color: a.tag.color,
                  }))}
                  size="sm"
                />
              </div>
            </div>
          </DataListCard>
        );
      })}
    </DataList>
  );
}
```

- [ ] **Step 2: Type-check + commit**

Run: `pnpm --filter dashboard type-check`
Expected: PASS.

```bash
git add apps/dashboard/features/contacts/contact/ui/contacts-mobile-list.tsx
git commit -m "feat(contacts): add contacts mobile card list with selection"
```

---

### Task 12: Add bulk-menu icons to the registry

**Files:**
- Modify: `packages/ui/src/components/icon-for.tsx`

- [ ] **Step 1: Add `Download` and `Layers` imports**

In `icon-for.tsx`, add `Download` and `Layers` to the `lucide-react` import block (keep it roughly alphabetical — `Download` after `CreditCard`, `Layers` after `KeyRound`).

- [ ] **Step 2: Add the two semantic wrappers**

Append:

```tsx
export const IconForExport = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Download ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForExport.displayName = "IconForExport";

export const IconForSegment = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Layers ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForSegment.displayName = "IconForSegment";
```

- [ ] **Step 3: Type-check + commit**

Run: `pnpm --filter @workspace/ui type-check`
Expected: PASS.

```bash
git add packages/ui/src/components/icon-for.tsx
git commit -m "feat(ui): add IconForExport and IconForSegment"
```

---

### Task 13: `add-contacts-to-segment-button-modal.tsx`

**Files:**
- Create: `apps/dashboard/features/contacts/contact-segment/ui/add-contacts-to-segment-button-modal.tsx`

Follow the NiceModal convention (`@ebay/nice-modal-react`, `NiceModal.create`, `useModal`, open via `NiceModal.show`).

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useEffect, useState } from "react";
import NiceModal, { useModal } from "@ebay/nice-modal-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Button } from "@workspace/ui/components/button";
import { Label } from "@workspace/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { toast } from "@workspace/ui/components/sonner";
import {
  addContactsToSegmentAction,
  listContactSegmentsAction,
} from "../data/contact-segment-actions";

export const AddContactsToSegmentButtonModal = NiceModal.create(
  ({
    contactIds,
    onSuccess,
  }: {
    contactIds: string[];
    onSuccess?: () => void;
  }) => {
    const modal = useModal();
    const [segments, setSegments] = useState<{ id: string; name: string }[]>([]);
    const [segmentId, setSegmentId] = useState<string>("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      void (async () => {
        const result = await listContactSegmentsAction();
        if (result.success) setSegments(result.data);
      })();
    }, []);

    async function handleAdd() {
      if (!segmentId || isSubmitting) return;
      setIsSubmitting(true);
      setError(null);
      try {
        const result = await addContactsToSegmentAction(segmentId, contactIds);
        if (!result.success) {
          setError(result.error);
          toast.error(result.error);
          return;
        }
        const segmentName = segments.find((s) => s.id === segmentId)?.name ?? "segment";
        toast.success(
          `Added ${result.data.addedCount} ${
            result.data.addedCount === 1 ? "contact" : "contacts"
          } to ${segmentName}`,
        );
        onSuccess?.();
        modal.hide();
      } finally {
        setIsSubmitting(false);
      }
    }

    return (
      <Dialog
        open={modal.visible}
        onOpenChange={(open) => {
          if (!open) modal.hide();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add to segment</DialogTitle>
            <DialogDescription>
              Add {contactIds.length} selected{" "}
              {contactIds.length === 1 ? "contact" : "contacts"} to a segment.
            </DialogDescription>
          </DialogHeader>

          {segments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No segments yet. Use “Save segment” in the contacts toolbar to create
              one first.
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="segment-select">Segment</Label>
              <Select value={segmentId} onValueChange={setSegmentId}>
                <SelectTrigger id="segment-select">
                  <SelectValue placeholder="Choose a segment" />
                </SelectTrigger>
                <SelectContent>
                  {segments.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => modal.hide()}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleAdd()}
              disabled={!segmentId || isSubmitting || segments.length === 0}
            >
              {isSubmitting ? "Adding…" : "Add to segment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
);
```

- [ ] **Step 2: Type-check + commit**

Run: `pnpm --filter dashboard type-check`
Expected: PASS.

```bash
git add apps/dashboard/features/contacts/contact-segment/ui/add-contacts-to-segment-button-modal.tsx
git commit -m "feat(contacts): add 'add contacts to segment' modal"
```

---

### Task 14: `contacts-bulk-actions.tsx`

**Files:**
- Create: `apps/dashboard/features/contacts/contact/ui/contacts-bulk-actions.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";

import type { Table as TanStackTable } from "@tanstack/react-table";
import NiceModal from "@ebay/nice-modal-react";
import { Button } from "@workspace/ui/components/button";
import { DataTableBulkActions } from "@workspace/ui/components/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  IconForExport,
  IconForMore,
  IconForSegment,
} from "@workspace/ui/components/icon-for";
import { toast } from "@workspace/ui/components/sonner";
import { exportContactsByIdsAction } from "../data/contact-csv-actions";
import { AddContactsToSegmentButtonModal } from "../../contact-segment/ui/add-contacts-to-segment-button-modal";
import type { Contact } from "./contacts-data-table";

function getSelectedIds<TData>(table: TanStackTable<TData>): string[] {
  const rowSelection = table.getState().rowSelection;
  return Object.keys(rowSelection).filter((id) => rowSelection[id]);
}

export function ContactsBulkActions({ table }: { table: TanStackTable<Contact> }) {
  async function handleExportSelected() {
    const ids = getSelectedIds(table);
    const result = await exportContactsByIdsAction(ids);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    const blob = new Blob([result.data], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "contacts-selected.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${ids.length} ${ids.length === 1 ? "contact" : "contacts"}`);
    table.resetRowSelection();
  }

  function handleAddToSegment() {
    const ids = getSelectedIds(table);
    void NiceModal.show(AddContactsToSegmentButtonModal, {
      contactIds: ids,
      onSuccess: () => table.resetRowSelection(),
    });
  }

  return (
    <DataTableBulkActions table={table}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <IconForMore className="mr-2" />
            Actions
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => void handleExportSelected()}>
            <IconForExport className="mr-2" />
            Export selected
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleAddToSegment}>
            <IconForSegment className="mr-2" />
            Add to segment
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </DataTableBulkActions>
  );
}
```

- [ ] **Step 2: Type-check + commit**

Run: `pnpm --filter dashboard type-check`
Expected: PASS.

```bash
git add apps/dashboard/features/contacts/contact/ui/contacts-bulk-actions.tsx
git commit -m "feat(contacts): add bulk actions bar (export selected, add to segment)"
```

---

### Task 15: `contacts-list.tsx` (orchestration shell)

**Files:**
- Create: `apps/dashboard/features/contacts/contact/ui/contacts-list.tsx`

This component owns selection + pagination + loading and renders the `ResponsiveDataView`, `DataTablePagination`, and bulk bar.

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getCoreRowModel,
  useReactTable,
  type PaginationState,
  type RowSelectionState,
} from "@tanstack/react-table";
import { DataTablePagination } from "@workspace/ui/components/data-table-pagination";
import { getDataTableSelectedRowCount } from "@workspace/ui/components/data-table";
import { ResponsiveDataView } from "@workspace/ui/components/responsive-data-view";
import type { ContactListFilters } from "@workspace/contacts/schemas/contact-schemas";
import { archiveContactAction, listContactsAction } from "../data/contact-actions";
import { listContactsForSegmentAction } from "../../contact-segment/data/contact-segment-actions";
import {
  ContactsDataTable,
  createContactColumns,
  type Contact,
  type ContactTableMeta,
} from "./contacts-data-table";
import { ContactsMobileList } from "./contacts-mobile-list";
import { ContactsBulkActions } from "./contacts-bulk-actions";

export type ContactsListQuery = Partial<ContactListFilters> & { segmentId?: string };

const PAGE_SIZE_OPTIONS = [5, 20, 50, 100, 1000];

export function ContactsList({
  query,
  orgSlug,
  refreshToken = 0,
}: {
  query: ContactsListQuery;
  orgSlug: string;
  refreshToken?: number;
}) {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [reloadTick, setReloadTick] = useState(0);
  const loadGenRef = useRef(0);

  // Filters changed → go back to the first page. Selection is intentionally NOT
  // cleared on filter/page changes (cross-page selection persists until cleared).
  useEffect(() => {
    setPagination((prev) => (prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }));
  }, [query]);

  // Load the current page whenever filters, pagination, or a manual reload change.
  useEffect(() => {
    const gen = ++loadGenRef.current;
    const page = pagination.pageIndex + 1;
    const pageSize = pagination.pageSize;
    startTransition(async () => {
      const result = query.segmentId
        ? await listContactsForSegmentAction(query.segmentId, { page, pageSize })
        : await listContactsAction({
            search: query.search,
            stageId: query.stageId,
            tagIds: query.tagIds,
            page,
            pageSize,
          });
      if (gen !== loadGenRef.current) return;
      if (result.success) {
        setContacts(result.data.rows);
        setTotalCount(result.data.totalCount);
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }, [query, pagination.pageIndex, pagination.pageSize, refreshToken, reloadTick]);

  async function handleArchive(id: string) {
    const result = await archiveContactAction(id);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setError(null);
    setReloadTick((t) => t + 1);
  }

  const columns = useMemo(() => createContactColumns(), []);

  const table = useReactTable<Contact>({
    data: contacts,
    columns,
    state: { pagination, rowSelection },
    manualPagination: true,
    pageCount: Math.max(1, Math.ceil(totalCount / pagination.pageSize)),
    rowCount: totalCount,
    getRowId: (row) => row.id,
    enableRowSelection: true,
    onPaginationChange: setPagination,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    meta: {
      onView: (id: string) => router.push(`/${orgSlug}/contacts/${id}`),
      onArchive: handleArchive,
    } satisfies ContactTableMeta,
  });

  return (
    <div className="relative flex flex-col overflow-hidden">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <ResponsiveDataView
        mobile={<ContactsMobileList table={table} isPending={isPending} />}
        desktop={<ContactsDataTable table={table} isPending={isPending} />}
      />
      <DataTablePagination table={table} pageSizeOptions={PAGE_SIZE_OPTIONS} />
      {getDataTableSelectedRowCount(table) > 0 && (
        <ContactsBulkActions table={table} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter dashboard type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/features/contacts/contact/ui/contacts-list.tsx
git commit -m "feat(contacts): add ContactsList shell with pagination + cross-page selection"
```

---

### Task 16: Refactor `contacts-page-content.tsx` to delegate to `ContactsList`

**Files:**
- Modify: `apps/dashboard/features/contacts/contact/ui/contacts-page-content.tsx`

The page keeps filters, toolbar, header, and the New/Import/Export-CSV actions. It drops the inline list, the list-loading logic, `ContactRowActions`, and `handleArchive` (now in `ContactsList`). It passes `query`, `orgSlug`, and a `refreshToken` (bumped after add-contact / CSV import) into `<ContactsList>`.

- [ ] **Step 1: Replace the whole file**

```tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import NiceModal from "@ebay/nice-modal-react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { StageView, TagView } from "@workspace/ui/components/entity-label-views";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Page, PageBody } from "@workspace/ui/components/page";
import { PageToolbar, ResponsivePageToolbarFilters } from "@workspace/ui/components/page-toolbar";
import {
  ResponsivePageAction,
  ResponsivePageActions,
} from "@workspace/ui/components/responsive-page-actions";
import { IconForAdd } from "@workspace/ui/components/icon-for";
import { responsiveLayout } from "@workspace/ui/lib/responsive-layout";
import { PageHeaderInOrg } from "@/common/ui/page-header-in-org";
import { exportContactsCsvAction } from "../data/contact-csv-actions";
import { listContactStagesAction } from "../../contact-stage/data/contact-stage-actions";
import { listContactTagsAction } from "../../contact-tag/data/contact-tag-actions";
import { listContactSegmentsAction } from "../../contact-segment/data/contact-segment-actions";
import { SaveContactSegmentButtonModal } from "../../contact-segment/ui/save-contact-segment-button-modal";
import { AddContactButtonModal } from "./add-contact-button-modal";
import { openAddContactFlow, type AddContactResult } from "./add-contact-flow";
import { CsvImportDialog } from "./csv-import-dialog";
import { ContactsList, type ContactsListQuery } from "./contacts-list";

const EMPTY_QUERY: ContactsListQuery = {};

function hasActiveFilters(query: ContactsListQuery) {
  return Boolean(query.search || query.stageId || query.tagIds?.length || query.segmentId);
}

function activeFilterCount(query: ContactsListQuery) {
  let count = 0;
  if (query.segmentId) count += 1;
  if (query.stageId) count += 1;
  if (query.tagIds?.length) count += 1;
  return count;
}

export function ContactsPageContent({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const [query, setQuery] = useState<ContactsListQuery>(EMPTY_QUERY);
  const [searchInput, setSearchInput] = useState("");
  const [stages, setStages] = useState<{ id: string; name: string; color: string }[]>([]);
  const [tags, setTags] = useState<{ id: string; name: string; color: string }[]>([]);
  const [segments, setSegments] = useState<{ id: string; name: string }[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = () => setRefreshToken((t) => t + 1);

  useEffect(() => {
    void (async () => {
      const [stagesResult, tagsResult, segmentsResult] = await Promise.all([
        listContactStagesAction(),
        listContactTagsAction(),
        listContactSegmentsAction(),
      ]);
      if (stagesResult.success) setStages(stagesResult.data);
      if (tagsResult.success) setTags(tagsResult.data);
      if (segmentsResult.success) setSegments(segmentsResult.data);
    })();
  }, []);

  function applyQuery(patch: Partial<ContactsListQuery>) {
    setQuery((prev) => ({ ...prev, ...patch }));
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setSearchInput(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      applyQuery({ search: value || undefined, segmentId: undefined });
    }, 300);
  }

  function handleClearFilters() {
    setSearchInput("");
    setQuery(EMPTY_QUERY);
  }

  async function handleExport() {
    const result = await exportContactsCsvAction({
      segmentId: query.segmentId,
      filters: {
        search: query.search,
        stageId: query.stageId,
        tagIds: query.tagIds,
      },
    });
    if (!result.success) return;
    const blob = new Blob([result.data], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "contacts.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleAddContact() {
    await openAddContactFlow({
      orgSlug,
      router,
      showAddContactModal: () =>
        NiceModal.show(AddContactButtonModal) as Promise<AddContactResult | undefined>,
    });
    refresh();
  }

  async function handleSaveSegment() {
    const saved = await NiceModal.show(SaveContactSegmentButtonModal, {
      filters: {
        search: query.search,
        stageId: query.stageId,
        tagIds: query.tagIds,
      },
    });
    if (saved) {
      const segmentsResult = await listContactSegmentsAction();
      if (segmentsResult.success) setSegments(segmentsResult.data);
    }
  }

  const filterFields = (
    <>
      <Select
        value={query.segmentId ?? "__all__"}
        onValueChange={(value) =>
          applyQuery({
            segmentId: value === "__all__" ? undefined : value,
            search: query.search,
            stageId: query.stageId,
            tagIds: query.tagIds,
          })
        }
      >
        <SelectTrigger className="h-9 w-full sm:w-44">
          <SelectValue placeholder="Segment" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All contacts</SelectItem>
          {segments.map((segment) => (
            <SelectItem key={segment.id} value={segment.id}>
              {segment.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={query.stageId ?? "__all__"}
        onValueChange={(value) =>
          applyQuery({
            stageId: value === "__all__" ? undefined : value,
            segmentId: undefined,
          })
        }
      >
        <SelectTrigger className="h-9 w-full sm:w-40">
          <SelectValue placeholder="Stage" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All stages</SelectItem>
          {stages.map((stage) => (
            <SelectItem key={stage.id} value={stage.id}>
              <StageView name={stage.name} color={stage.color} size="sm" />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={query.tagIds?.[0] ?? "__all__"}
        onValueChange={(value) =>
          applyQuery({
            tagIds: value === "__all__" ? undefined : [value],
            segmentId: undefined,
          })
        }
      >
        <SelectTrigger className="h-9 w-full sm:w-40">
          <SelectValue placeholder="Tag" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All tags</SelectItem>
          {tags.map((tag) => (
            <SelectItem key={tag.id} value={tag.id}>
              <TagView name={tag.name} color={tag.color} size="sm" />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );

  const filterActions = hasActiveFilters(query) ? (
    <>
      <Button variant="ghost" size="sm" className="h-9" onClick={handleClearFilters}>
        Clear filters
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-9"
        onClick={() => void handleSaveSegment()}
      >
        Save segment
      </Button>
    </>
  ) : null;

  const filterToolbar = (
    <PageToolbar>
      <Input
        placeholder="Search contacts…"
        value={searchInput}
        onChange={handleSearchChange}
        className="h-9 min-w-0 flex-1 md:max-w-[400px] md:flex-none"
      />
      <ResponsivePageToolbarFilters
        activeCount={activeFilterCount(query)}
        drawerTitle="Filter contacts"
        drawerFooter={filterActions}
      >
        {filterFields}
      </ResponsivePageToolbarFilters>
      {filterActions ? (
        <div className="hidden items-center gap-2 md:flex">{filterActions}</div>
      ) : null}
    </PageToolbar>
  );

  return (
    <Page className="flex min-h-0 flex-1 flex-col">
      <PageHeaderInOrg
        title="Contacts"
        description="Manage people and companies in this organization."
        actions={
          <ResponsivePageActions
            primary={
              <Button onClick={() => void handleAddContact()}>
                <IconForAdd className="md:mr-2" />
                <span className="hidden md:inline">New Contact</span>
                <span className="sr-only md:hidden">New Contact</span>
              </Button>
            }
            secondary={
              <>
                <ResponsivePageAction>
                  <CsvImportDialog onImported={refresh} />
                </ResponsivePageAction>
                <ResponsivePageAction>
                  <Button variant="outline" onClick={() => void handleExport()}>
                    Export CSV
                  </Button>
                </ResponsivePageAction>
              </>
            }
          />
        }
        toolbar={filterToolbar}
      />
      <PageBody className={`space-y-4 ${responsiveLayout.pageBodyPadding}`}>
        <ContactsList query={query} orgSlug={orgSlug} refreshToken={refreshToken} />
      </PageBody>
    </Page>
  );
}
```

- [ ] **Step 2: Type-check + lint**

Run: `pnpm --filter dashboard type-check && pnpm lint`
Expected: PASS. (Lint will flag any now-unused imports — remove them.)

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/features/contacts/contact/ui/contacts-page-content.tsx
git commit -m "refactor(contacts): page delegates list rendering to ContactsList"
```

---

# Phase 5 — AI skill `create-data-table`

> 5 artifacts, all created by hand (no sync script): 1 canonical SKILL.md + 2 wrappers + 2 registration edits. Frontmatter `name`/`description` must be **identical** across canonical and both wrappers.

### Task 17: Canonical `SKILL.md`

**Files:**
- Create: `.ai/skills/create-data-table/SKILL.md`

- [ ] **Step 1: Create the canonical skill**

```markdown
---
name: create-data-table
description: >-
  Build a paginated entity list with desktop data table, mobile card list,
  cross-page row selection, and bulk actions. Use when adding a paginated table,
  bulk selection, bulk export, or "add selected to …" flows to a dashboard list.
---

# Create Data Table

## Purpose

Use this skill when adding or substantially changing a **paginated list with
optional bulk actions** in a dashboard feature. It establishes one structure:
server-driven pagination, a desktop `DataTable` (md+) and a mobile card list
(< md) over the same page of rows, and `rowSelection` lifted above both so
selection persists across pages.

Reference implementation: the contacts list
(`apps/dashboard/features/contacts/contact/ui/`) and its spec
`docs/superpowers/specs/2026-05-23-contacts-export-selected-and-data-table-pattern.md`.

## Core Rules

- **Ask the user first** (one topic at a time during design):
  - Entity and feature path.
  - Which bulk actions (export selected, add to group/segment, delete, assign…).
  - Pagination default and page-size options (contacts uses default 20, options
    `[5, 20, 50, 100, 1000]`).
  - Whether special filter modes exist (e.g. segments).
  - Mobile + desktop both required? Default **yes** for dashboard lists.
- **Server-driven pagination.** List actions return `{ rows, totalCount }`. Build
  the where clause once (shared by list + count) so they never drift.
- **Lift `rowSelection` and pagination** into a single `*-list.tsx` shell above
  `ResponsiveDataView`. Do not keep selection inside the table or card components.
- **Use `getRowId: (row) => row.id`** so selection keys are domain IDs — bulk
  actions then operate on IDs directly across pages.
- **Cross-page selection persists.** Do not clear selection on page or filter
  change. Reset `pageIndex` to 0 when filters change.
- **Domain logic lives in `packages/<domain>`** (repos under `data-models/`,
  services under `services/`). Bulk server actions live in
  `apps/.../<feature>/data/*-actions.ts` and delegate to the domain package.
- **CSV uses PapaParse** via the domain `csv-service` (`exportContactsToCsv` /
  `Papa.unparse`). Never add a second CSV library.
- **Bulk flows that need input** (pick a segment) use NiceModal
  (`add-modal-or-confirm-dialog`). A direct action + toast is fine for export.
- **Icons** come from `@workspace/ui/components/icon-for` (`add-icon`) — never
  `lucide-react` in app code.

## File Layout

```text
apps/dashboard/features/<domain>/<entity>/ui/
  <entity>s-page-content.tsx     # filters, toolbar; renders <EntityList>
  <entity>s-list.tsx             # selection + pagination + load + ResponsiveDataView
  <entity>s-data-table.tsx       # createColumns() + desktop DataTable
  <entity>s-mobile-list.tsx      # DataListCard + leading checkbox
  <entity>s-bulk-actions.tsx     # DataTableBulkActions menu
apps/dashboard/features/<domain>/<entity>/data/
  <entity>-actions.ts            # list → { rows, totalCount }
  <entity>-csv-actions.ts        # exportByIdsAction
packages/<domain>/src/
  data-models/<entity>-repo.ts   # buildListWhere, list, count, listByIds
  services/...                   # bulk domain operations
```

## Shared UI primitives (`@workspace/ui`)

- `createDataTableSelectColumn<T>()` — first column; checkbox header (current
  page) + cell (row); both `stopPropagation` so row navigation still works.
- `DataTable` — pass a TanStack `table` instance; use `onRowClicked` for row
  navigation and `emptyState` for loading/empty.
- `DataTablePagination` — pass the same `table`; set `pageSizeOptions`.
- `DataTableBulkActions` — renders the "N selected" bar; uses
  `getDataTableSelectedRowCount(table)` (counts `rowSelection` keys, correct
  under manual pagination) and `table.resetRowSelection()` to clear all pages.

## TanStack table config (in the list shell)

```ts
const table = useReactTable({
  data: rows,
  columns,
  state: { pagination, rowSelection },
  manualPagination: true,
  pageCount: Math.max(1, Math.ceil(totalCount / pagination.pageSize)),
  rowCount: totalCount,
  getRowId: (row) => row.id,
  enableRowSelection: true,
  onPaginationChange: setPagination,
  onRowSelectionChange: setRowSelection,
  getCoreRowModel: getCoreRowModel(),
  meta: { onView, onArchive },
});
```

## Checklist

- [ ] Asked the user about entity, bulk actions, pagination, filters, mobile/desktop
- [ ] List action returns `{ rows, totalCount }`; count + list share one where builder
- [ ] `*-list.tsx` owns `rowSelection` + `pagination`; selection persists across pages
- [ ] `getRowId: (row) => row.id`; `manualPagination: true`; `pageCount`/`rowCount` set
- [ ] Desktop `DataTable` + mobile card list both render the same `table`
- [ ] Select column via `createDataTableSelectColumn`; checkboxes `stopPropagation`
- [ ] Bulk bar uses `getDataTableSelectedRowCount`; clears via `resetRowSelection`
- [ ] Bulk actions delegate to domain repos/services; CSV via PapaParse
- [ ] Modals via NiceModal; icons via `icon-for`
- [ ] Colocated unit tests for repos, count/list parity, and bulk actions

## Boundary Rules

- No "select all matching filters" (server-side select-all) unless explicitly
  requested — v1 selects only loaded/clicked rows.
- Bulk actions touching domain rules (segments, tags) extend the domain package,
  not app-level Prisma.
```

- [ ] **Step 2: Commit**

```bash
git add .ai/skills/create-data-table/SKILL.md
git commit -m "docs(skills): add create-data-table canonical skill"
```

---

### Task 18: Wrappers + registration

**Files:**
- Create: `.cursor/skills/create-data-table/SKILL.md`
- Create: `.claude/skills/create-data-table/SKILL.md`
- Modify: `.cursor/rules/shared-ai-guidance.mdc`
- Modify: `.ai/README.md`

- [ ] **Step 1: Create both wrappers (byte-identical)**

Write the same content to **both** `.cursor/skills/create-data-table/SKILL.md` and `.claude/skills/create-data-table/SKILL.md`:

```markdown
---
name: create-data-table
description: >-
  Build a paginated entity list with desktop data table, mobile card list,
  cross-page row selection, and bulk actions. Use when adding a paginated table,
  bulk selection, bulk export, or "add selected to …" flows to a dashboard list.
---

# Create Data Table

Canonical instructions live at [`.ai/skills/create-data-table/SKILL.md`](../../../.ai/skills/create-data-table/SKILL.md).

Before building a paginated list with bulk actions, read and follow the canonical skill.
```

- [ ] **Step 2: Register in `.cursor/rules/shared-ai-guidance.mdc`**

Add this line in the same "When … read …" list as the other skills:

```
When adding a paginated list/table, bulk row selection, bulk export, or "add selected to …" flows to a dashboard list, read `.ai/skills/create-data-table/SKILL.md` before making changes.
```

- [ ] **Step 3: Register in `.ai/README.md`**

Add this bullet to the `## Skills` list:

```
- [`skills/create-data-table/SKILL.md`](./skills/create-data-table/SKILL.md) - Paginated data tables with mobile card lists, cross-page selection, and bulk actions.
```

- [ ] **Step 4: Commit**

```bash
git add .cursor/skills/create-data-table/SKILL.md \
        .claude/skills/create-data-table/SKILL.md \
        .cursor/rules/shared-ai-guidance.mdc \
        .ai/README.md
git commit -m "docs(skills): wrap and register create-data-table skill"
```

---

# Phase 6 — Verification & QA

### Task 19: Full verification + manual QA

**Files:** none (verification only)

- [ ] **Step 1: Type-check the whole repo**

Run: `pnpm type-check`
Expected: PASS.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: PASS (no `lucide-react` imports in `apps/`; no unused imports left in `contacts-page-content.tsx`).

- [ ] **Step 3: Domain tests**

Run: `pnpm test --filter @workspace/contacts`
Expected: PASS — repo count/by-ids, schema v2, segment membership OR semantics, `addContactsToSegment`.

- [ ] **Step 4: Dashboard tests**

Run: `pnpm test --filter dashboard`
Expected: PASS — `exportContactsByIdsAction`, `addContactsToSegmentAction`, `listContactsAction` shape, plus existing contact/permission tests.

- [ ] **Step 5: UI tests**

Run: `pnpm test --filter @workspace/ui`
Expected: PASS — `getDataTableSelectedRowCount`, `createDataTableSelectColumn`.

- [ ] **Step 6: Manual QA** (run the dashboard, sign in, open `/<org>/contacts`)

Use the `run` skill (or `pnpm dev`) and verify against the spec's Verification section:
- [ ] Select rows on **desktop** (checkboxes); bulk bar shows correct count.
- [ ] Change page; previously selected rows stay counted; select more → count grows across pages.
- [ ] Select rows on **mobile** (card checkboxes); row/card tap still navigates.
- [ ] **Export selected** downloads `contacts-selected.csv` with the selected rows; toast shows; selection clears.
- [ ] **Add to segment** → pick a segment → toast "Added N contacts to {name}"; opening that segment in the filter shows those contacts (explicit membership via v2).
- [ ] Toolbar **Export CSV** still exports the full filtered set (unchanged, `contacts.csv`).
- [ ] Page-size selector offers 5 / 20 / 50 / 100 / 1000 and re-pages correctly.
- [ ] Empty state and loading state render in both table and mobile list.

- [ ] **Step 7: Request code review**

Use `superpowers:requesting-code-review` (or `/code-review`) against the branch before integrating.

---

## Spec coverage self-check

| Spec requirement | Task |
|---|---|
| Reusable reference implementation (contacts) | 10–16 |
| Export selected (server-side, org-scoped, ≤1000, fail on mismatch) | 5, 14 |
| Add selected to segment (merge, dedupe, v1→v2 upgrade) | 2–4, 6, 13, 14 |
| Segment membership model v2 (`contactIds`, OR semantics) | 2, 3 |
| Server-driven pagination + `DataTablePagination` (default 20, options 5–1000) | 7, 15 |
| `createDataTableSelectColumn` | 9 |
| `getDataTableSelectedRowCount` + bulk-bar count fix | 8 |
| Cross-page selection persistence | 15 |
| AI skill `create-data-table` + wrappers + registration | 17, 18 |
| Critical tests (repo, schema, service, actions, ui) | 1–9 |
| Error handling (empty/over-max/missing IDs/no segments) | 5, 6, 13, 14 |
| Toolbar export unchanged | 16 (kept) |

**Non-goals (not implemented):** server-side "select all matching", bulk archive/assign/Excel, individual segment removal, `nuqs` URL-synced pagination, dev-helpers demo update.
