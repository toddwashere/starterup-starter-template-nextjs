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
