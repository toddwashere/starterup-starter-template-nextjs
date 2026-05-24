# Contacts Export Selected & Responsive Data Table Pattern

**Date:** 2026-05-23  
**Status:** Draft — awaiting review

## Overview

Establish a **reusable pattern** for paginated entity lists with **desktop data tables**, **mobile card lists**, **cross-page row selection**, and **bulk actions** — using the contacts feature as the reference implementation.

The v1 bulk actions are **Export selected** (CSV) and **Add selected to segment**. The existing toolbar **Export CSV** (all rows matching current filters) remains unchanged.

This spec also defines a new AI skill **`create-data-table`** (canonical path: `.ai/skills/create-data-table/SKILL.md`) so future list features follow the same structure. Invoke via `/create-data-table` or when adding paginated tables, bulk selection, or bulk export.

### Decisions (locked)

| Topic | Decision |
|--------|----------|
| Selection UI | **Desktop and mobile** — shared selection state across `ResponsiveDataView` |
| Cross-page selection | **Persist until cleared** — selecting on page 1, navigating to page 2, selecting more → export includes all selected IDs |
| Toolbar vs bulk export | **C** — toolbar exports all matching filters; bulk bar appears only when ≥1 row selected |
| Bulk menu (v1) | **Export selected** + **Add selected to segment** |
| Architecture | **ContactsList shell** — lifted selection + pagination; `contacts-data-table` (desktop) + `contacts-mobile-list` (mobile) |
| Pagination default | **20** rows per page |
| Page size options | **5, 20, 50, 100, 1000** (5 and 1000 for testing) |
| CSV library | **PapaParse** (`papaparse`) — already used in `packages/contacts/src/services/csv-service.ts` via `exportContactsToCsv` / `parseContactsCsv`; do not add a second CSV library |

### Partial work note

An interrupted implementation pass may have already landed **domain-only** changes:

- `packages/contacts/src/data-models/contact-repo.ts` — `buildContactListWhere`, `countContactsMatchingListFilters`, `listContactsByIds`, `contactListInclude`
- `packages/contacts/src/schemas/contact-schemas.ts` — `pageSize` max raised to 1000
- `packages/contacts/src/services/segment-service.ts` — `countContactsForSegment`

The implementation plan must verify these and complete everything else. Do not assume the feature is done.

---

## Goals

1. **Reference implementation** on the contacts list page that other features can copy.
2. **Export selected contacts** — server-side fetch by ID, org-scoped, same CSV columns as full export.
3. **Add selected contacts to segment** — merge selected contact IDs into a chosen segment (see [Segment membership model](#segment-membership-model) below).
4. **Server-driven pagination** with `DataTablePagination` from `@workspace/ui`.
5. **AI skill** documenting the full convention (including asking the user about bulk actions, pagination, and mobile layout during design).

## Non-goals (v1)

- “Select all X matching filters” (server-side select-all)
- Bulk archive, assign stage/tags, or Excel export
- Removing contacts from a segment individually (future)
- URL-synced pagination (`nuqs`)
- Dev-helpers extended-components demo update (optional follow-up)

---

## Architecture

```text
apps/dashboard/features/contacts/contact/ui/
  contacts-page-content.tsx     # filters, toolbar, delegates list
  contacts-list.tsx             # selection, pagination, load, ResponsiveDataView
  contacts-data-table.tsx       # TanStack DataTable (md+)
  contacts-mobile-list.tsx      # DataListCard + checkbox (< md)
  contacts-bulk-actions.tsx       # DataTableBulkActions menu
  add-contacts-to-segment-button-modal.tsx  # NiceModal: pick segment

packages/ui/src/components/
  data-table-select-column.tsx  # createDataTableSelectColumn<T>()
  data-table.tsx                # getDataTableSelectedRowCount; fix bulk bar count

packages/contacts/src/
  data-models/contact-repo.ts   # buildContactListWhere, list/count/byIds
  services/segment-service.ts   # count/list segments; addContactsToSegment
  services/csv-service.ts         # unchanged Papa.unparse path
  schemas/segment-schemas.ts    # filter v2 + contactIds

apps/dashboard/features/contacts/contact/data/
  contact-actions.ts            # list → { rows, totalCount }
  contact-csv-actions.ts        # exportContactsByIdsAction
apps/dashboard/features/contacts/contact-segment/data/
  contact-segment-actions.ts    # list → { rows, totalCount }; addContactsToSegmentAction
```

**Conceptual split:** **Data table** = desktop (`DataTable` + TanStack). **List** = mobile (`DataList` / `DataListCard`). Both are views over the same page of rows and the same `rowSelection` state.

---

## Domain layer (`packages/contacts`)

All repository code lives under `packages/contacts/src/data-models/` (e.g. `contact-repo.ts`), not at package root.

### `contact-repo.ts`

| Function | Purpose |
|----------|---------|
| `buildContactListWhere(orgId, filters)` | Shared `Prisma.ContactWhereInput` for list + count (avoid drift) |
| `listContactsForOrg` | Paginated list; uses `buildContactListWhere` + `contactListInclude` |
| `countContactsMatchingListFilters` | Total row count for current filters (pagination `pageCount`) |
| `listContactsByIds(orgId, ids)` | Fetch contacts for export; `where: { organizationId, id: { in: ids }, archivedAt: null }`; same include as list |

### Segment membership model

`ContactSegment` rows store **JSON filters**, not a join table. Segments today are dynamic (search, kind, stage, tags). To support explicit “these contacts belong in this segment” without a schema migration:

**Filter version 2** adds optional `contactIds: string[]` on the segment filter payload.

**Membership rule:** a contact is in the segment if it matches the **dynamic filters** OR its `id` is listed in `contactIds`:

```ts
where: {
  organizationId,
  OR: [
    buildContactWhereFromSegment(dynamicFilters), // excludes contactIds field
    ...(contactIds.length ? [{ id: { in: contactIds } }] : []),
  ],
}
```

- v1 segments (no `contactIds`) behave exactly as today.
- When bulk-adding contacts, **merge** new IDs into `contactIds` (set union, dedupe). Do not replace dynamic filters.
- v1 segments gain `filterVersion: 2` on first bulk add (persist upgraded filters).

### `segment-service.ts`

| Function | Purpose |
|----------|---------|
| `countContactsForSegment(orgId, segmentId)` | Total for segment (uses v2 OR semantics) |
| `listContactsForSegment` | Paginated list (uses v2 OR semantics) |
| `addContactsToSegment(orgId, segmentId, contactIds)` | Load segment, merge IDs into `contactIds`, upgrade to v2 if needed, `updateContactSegment` |

Validate all `contactIds` exist in org (via `listContactsByIds` or count) before merge; **fail** if any ID missing.

### Schemas (`packages/contacts/src/schemas/segment-schemas.ts`)

- `CURRENT_FILTER_VERSION` → **2** for new segments (v1 still readable).
- `ContactSegmentFilterSchemaV2` = v1 fields + `contactIds: z.array(z.string()).optional()`.
- `validateSegmentFilters` accepts version **1** and **2**.
- `CreateContactSegmentSchema` uses v2 for new segments created via “Save segment” (optional: keep creating v1 until bulk feature ships — prefer v2 everywhere new).

### Contact list schemas

- `ContactListFiltersSchema.pageSize`: max **1000**, default **20** (already may be updated).

### CSV export

- Reuse `exportContactsToCsv` and `formatContactTagsForCsv` from `@workspace/contacts`.
- **PapaParse** is the standard for this monorepo: `Papa.unparse` for export, `Papa.parse` for import. No new CSV dependency.

---

## Server actions

### `listContactsAction`

Return shape:

```ts
{ rows: Contact[]; totalCount: number }
```

- `rows` from `listContactsForOrg` with `page`, `pageSize`, and filter fields.
- `totalCount` from `countContactsMatchingListFilters` with the same filters (excluding pagination).

### `listContactsForSegmentAction`

Same `{ rows, totalCount }` shape; `totalCount` from `countContactsForSegment`.

### `exportContactsByIdsAction(contactIds: string[])`

- Permission: `contact: ["export"]` via `requireOrgPermissionWithActiveOrg`.
- **Max IDs:** 1000 per request (align with max page size / testing).
- Load via `listContactsByIds`.
- **Fail** if `contacts.length !== contactIds.length` (no silent partial export).
- Map to `CsvContactRow` and return CSV string via `exportContactsToCsv`.
- Toolbar `exportContactsCsvAction` (filter-based, up to 5000) stays unchanged.

### `addContactsToSegmentAction(segmentId, contactIds)`

Location: `apps/dashboard/features/contacts/contact-segment/data/contact-segment-actions.ts`

- Permission: `contactSettings: ["update"]` (or `["create"]` if update is not defined — match existing segment mutation permissions).
- **Max IDs:** 1000 per request (same cap as export).
- Delegate to `addContactsToSegment` in `@workspace/contacts`.
- Return `{ addedCount: number; totalExplicitIds: number }` for toast copy.

---

## UI — `ContactsList` orchestration

### State (owned by `contacts-list.tsx`)

| State | Notes |
|-------|--------|
| `rowSelection` | `RowSelectionState`; **not** cleared on page change |
| Pagination | TanStack `pagination` (`pageIndex`, `pageSize`); default `pageSize: 20` |
| `contacts`, `totalCount` | From server actions |
| `isPending` | `useTransition` around loads |

### Loading

On filter change: reset `pageIndex` to 0, clear selection optional — **do not clear selection on page change**; **do** reset page index when filters change.

`useReactTable`:

- `manualPagination: true`
- `pageCount: Math.ceil(totalCount / pageSize)` (min 1)
- `rowCount: totalCount`
- `getRowId: (row) => row.id`
- `enableRowSelection: true`
- Controlled `rowSelection` / `onRowSelectionChange`

### Layout

```text
<div className="relative flex flex-col overflow-hidden">
  <ResponsiveDataView
    mobile={<ContactsMobileList ... />}
    desktop={<ContactsDataTable ... />}
  />
  <DataTablePagination table={table} pageSizeOptions={[5, 20, 50, 100, 1000]} />
  {selectedCount > 0 && <ContactsBulkActions table={table} />}
</div>
```

`DataTablePagination` requires a TanStack `table` instance even when the mobile list is visible — the table holds pagination state for both breakpoints.

### Cross-page selection count

`DataTableBulkActions` today uses `table.getSelectedRowModel().rows.length`, which under **manual pagination** only reflects the current page. Update shared UI to count from `rowSelection` state keys (e.g. `getDataTableSelectedRowCount(table)` in `packages/ui`) so the bulk bar shows the correct total across pages.

### Desktop — `contacts-data-table.tsx`

- `createDataTableSelectColumn<Contact>()` as first column.
- Checkbox `onClick={(e) => e.stopPropagation()}` so `onRowClicked` navigation still works.
- Header: `toggleAllPageRowsSelected` (current page only).
- Reuse existing columns: name, kind, email, stage, tags, row actions.
- `DataTable` with `onRowClicked` → contact detail route.

### Mobile — `contacts-mobile-list.tsx`

- `DataList` / `DataListCard` with leading **checkbox** per card.
- Checkbox `stopPropagation` so card activate still navigates.
- `row.getIsSelected()` / `row.toggleSelected` via table row API, or sync with parent `rowSelection`.
- Same row actions as today (`ContactRowActions`).

### Bulk — `contacts-bulk-actions.tsx`

- Wrap `DataTableBulkActions`.
- Dropdown menu (v1):
  1. **Export selected** — call `exportContactsByIdsAction(ids)`; on success download `contacts-selected.csv`; `toast.success`; clear selection.
  2. **Add to segment** — `NiceModal.show(AddContactsToSegmentButtonModal, { contactIds: selectedIds, onSuccess })`.
- On export error: `toast.error`; keep selection.
- Use `IconFor*` for menu icons (not `lucide-react` in apps).

### Modal — `add-contacts-to-segment-button-modal.tsx`

Per `.ai/skills/add-modal-or-confirm-dialog/SKILL.md`:

- File: `apps/dashboard/features/contacts/contact-segment/ui/add-contacts-to-segment-button-modal.tsx` (or under `contact/ui/` if colocated with bulk actions — prefer **contact-segment** feature folder).
- Props: `contactIds: string[]`, optional `onSuccess?: () => void`.
- UI: `Dialog` with segment `Select` or `ComboBox` populated from `listContactSegmentsAction`.
- Submit: `addContactsToSegmentAction(segmentId, contactIds)`.
- Success: toast (e.g. “Added 5 contacts to {segment name}”), `modal.hide()`, `onSuccess` (refresh segment list in parent if needed), clear table selection via callback.
- Empty segments list: show helper text to create a segment first (link or mention toolbar “Save segment”).

### Page — `contacts-page-content.tsx`

- Keeps filters, toolbar (New contact, Import, **Export CSV**), segment/stage/tag UI.
- Replaces inline `Table` / mobile cards with `<ContactsList query={...} orgSlug={...} />`.

---

## Shared UI primitives (`packages/ui`)

### `createDataTableSelectColumn<TData>()`

Returns `ColumnDef<TData>` with id `select`, checkbox header/cell, `enableSorting: false`, `enableHiding: false`.

Export from `@workspace/ui/components/data-table` (or `data-table-select-column` subpath if exports require it).

### `getDataTableSelectedRowCount(table)`

Counts selected IDs from `table.getState().rowSelection` for accurate cross-page bulk UI.

Update `DataTableBulkActions` to use this helper for the “N selected” label and ensure deselect clears all pages.

---

## AI skill: `create-data-table`

**Canonical:** `.ai/skills/create-data-table/SKILL.md`  
**Wrappers:** `.cursor/skills/create-data-table/SKILL.md`, `.claude/skills/create-data-table/SKILL.md`  
**Register:** `.cursor/rules/shared-ai-guidance.mdc` + `.ai/README.md`

### Skill purpose

When adding or substantially changing a **paginated list with optional bulk actions**, the agent must:

1. **Ask the user** (one topic at a time during design):
   - Entity and feature path
   - Which bulk actions (export selected, delete, assign, etc.)
   - Pagination defaults and page-size options
   - Whether segment or special filter modes exist
   - Mobile + desktop required (default **yes** for dashboard lists)
2. Follow file naming and layout conventions from this spec.
3. Use server pagination + `DataTablePagination`.
4. Lift `rowSelection` above `ResponsiveDataView`.
5. Use domain repos under `packages/<domain>/src/data-models/`, bulk server actions in `apps/.../data/*-actions.ts`.
6. Use PapaParse for CSV in domain packages that already use `@workspace/contacts` csv-service pattern.
7. Use NiceModal for bulk flows that need user input (e.g. pick segment); direct action + toast is fine for export.
8. When bulk action touches domain rules (segments, tags), extend `packages/contacts` services/repos — not app-level Prisma.

The skill body should include checklist, file templates, and links to this spec as the reference implementation.

**Implementation of the skill file is part of the same workstream** as the contacts feature (ship skill with or immediately before the reference UI).

---

## Error handling

| Case | Behavior |
|------|----------|
| Export with 0 selected | Bulk bar hidden; no-op |
| Export exceeds max IDs | Server error message; toast |
| Some IDs not found / wrong org | Fail entire export; toast |
| Add to segment: no segments | Modal explains; link to save/create segment |
| Add to segment: invalid IDs | Fail merge; toast; keep selection |
| Add to segment: duplicate IDs | Idempotent union — report only newly added count in toast |
| Empty list page | Standard empty state in table and mobile list |
| Load failure | Show error in page body (existing pattern) |

---

## Critical Tests

- `packages/contacts/src/data-models/contact-repo.test.ts`: `countContactsMatchingListFilters` uses same where as `listContactsForOrg`; `listContactsByIds` scopes to `organizationId` and excludes archived.
- `packages/contacts/src/services/segment-service.test.ts`: `countContactsForSegment` / `listContactsForSegment` use OR semantics when `contactIds` present; `addContactsToSegment` merges IDs and upgrades v1→v2.
- `apps/dashboard/features/contacts/contact/data/contact-csv-actions.test.ts` (or colocated): `exportContactsByIdsAction` requires export permission; rejects when found count ≠ requested; respects max IDs.
- `apps/dashboard/features/contacts/contact-segment/data/contact-segment-actions.test.ts` (or colocated): `addContactsToSegmentAction` requires permission; passes IDs to service.
- `apps/dashboard/features/contacts/contact/data/contact-actions.test.ts`: `listContactsAction` returns `{ rows, totalCount }`.
- `packages/ui/src/components/data-table-select-column.test.tsx` (optional): select column renders and stops propagation hook points documented.

Avoid E2E for v1; colocated unit tests only.

---

## Verification

- `pnpm type-check`
- `pnpm lint`
- `pnpm test --filter @workspace/contacts`
- `pnpm test --filter dashboard` (or targeted contact action tests)
- Manual: select rows on desktop and mobile; change page; export selected; add selected to segment (verify segment view shows those contacts); toolbar export still exports filtered set; pagination sizes 5–1000

---

## Open questions (none for v1)

All product questions were resolved in brainstorming:

- Mobile + desktop selection: **yes**
- Cross-page selection: **yes**
- Toolbar vs bulk: **separate behaviors (C)**

---

## Implementation order (for planning only)

1. Finish/verify domain + segment filter v2 + `addContactsToSegment` + tests  
2. Server actions (`list` shape, `exportContactsByIds`, `addContactsToSegment`)  
3. UI primitives (`createDataTableSelectColumn`, selected row count)  
4. Contacts list components + bulk actions + add-to-segment modal  
5. AI skill `create-data-table` + registration  
6. Manual QA  

**Next step after spec approval:** invoke **writing-plans** to produce `docs/superpowers/plans/2026-05-23-contacts-export-selected-and-data-table-pattern.md` with task checkboxes and Critical Tests echoed from this doc.
