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
        disabled={!row.getCanSelect()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        onClick={(event) => event.stopPropagation()}
      />
    ),
  }
}
