"use client"

import * as React from "react"
import {
  flexRender,
  type Column,
  type Row,
  type Table as TanStackTable,
} from "@tanstack/react-table"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  EyeOffIcon,
  Settings2Icon,
  XIcon,
} from "lucide-react"

import { cn } from "#lib/utils"
import { Button } from "#components/button"
import { DataTableFilter } from "#components/data-table-filter"
import { DataTablePagination } from "#components/data-table-pagination"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#components/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#components/table"

type ColumnMetaWithTitle = {
  title?: string
}

export type DataTableProps<TData> = Omit<
  React.ComponentProps<typeof Table>,
  "children"
> & {
  table: TanStackTable<TData>
  fixedHeader?: boolean
  wrapperClassName?: string
  onRowClicked?: (row: Row<TData>) => void
  renderSubComponent?: (props: { row: Row<TData> }) => React.ReactNode
  getRowClassName?: (row: Row<TData>) => string | undefined
  getRowTestId?: (row: Row<TData>, index: number) => string | undefined
  emptyState?: React.ReactNode
}

function getColumnTitle<TData, TValue>(column: Column<TData, TValue>) {
  const meta = column.columnDef.meta as ColumnMetaWithTitle | undefined

  return meta?.title ?? column.id
}

function DataTable<TData>({
  table,
  fixedHeader,
  wrapperClassName,
  onRowClicked,
  renderSubComponent,
  getRowClassName,
  getRowTestId,
  emptyState = "No results.",
  className,
  ...props
}: DataTableProps<TData>) {
  const rows = table.getRowModel().rows
  const visibleColumns = table.getVisibleLeafColumns().length

  return (
    <div className={cn("relative w-full", wrapperClassName)}>
      <Table className={className} {...props}>
        <TableHeader
          className={cn(
            fixedHeader && "sticky top-0 z-10 bg-background",
            "bg-muted/50"
          )}
        >
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} colSpan={header.colSpan}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length > 0 ? (
            rows.map((row, index) => (
              <React.Fragment key={row.id}>
                <TableRow
                  data-row-id={row.id}
                  data-testid={getRowTestId?.(row, index)}
                  data-state={row.getIsSelected() && "selected"}
                  tabIndex={onRowClicked ? 0 : undefined}
                  aria-label={onRowClicked ? `Open row ${row.id}` : undefined}
                  className={cn(
                    onRowClicked && "cursor-pointer",
                    getRowClassName?.(row)
                  )}
                  onClick={() => onRowClicked?.(row)}
                  onKeyDown={(event) => {
                    if (!onRowClicked) {
                      return
                    }

                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      onRowClicked(row)
                    }
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
                {row.getIsExpanded() && renderSubComponent && (
                  <TableRow>
                    <TableCell colSpan={row.getVisibleCells().length}>
                      {renderSubComponent({ row })}
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={Math.max(visibleColumns, 1)}
                className="h-24 text-center text-muted-foreground"
              >
                {emptyState}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

export type DataTableColumnHeaderProps<TData, TValue> =
  React.HTMLAttributes<HTMLDivElement> & {
    column: Column<TData, TValue>
    title: string
    titleContent?: React.ReactNode
  }

function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  titleContent,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  const label = titleContent ?? title

  if (!column.getCanSort() && !column.getCanHide()) {
    return <div className={cn("font-normal", className)}>{label}</div>
  }

  return (
    <div className={cn("flex items-center space-x-2", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-3 h-8 text-xs uppercase data-[state=open]:bg-accent"
          >
            <span>{label}</span>
            {column.getIsSorted() === "desc" ? (
              <ArrowDownIcon className="ml-2 size-4 shrink-0" aria-hidden="true" />
            ) : column.getIsSorted() === "asc" ? (
              <ArrowUpIcon className="ml-2 size-4 shrink-0" aria-hidden="true" />
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {column.getCanSort() && (
            <>
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => column.toggleSorting(false)}
              >
                <ArrowUpIcon className="mr-2 size-3.5 text-muted-foreground/70" />
                Sort ascending
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => column.toggleSorting(true)}
              >
                <ArrowDownIcon className="mr-2 size-3.5 text-muted-foreground/70" />
                Sort descending
              </DropdownMenuItem>
            </>
          )}
          {column.getCanSort() && column.getCanHide() && <DropdownMenuSeparator />}
          {column.getCanHide() && (
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => column.toggleVisibility(false)}
            >
              <EyeOffIcon className="mr-2 size-3.5 text-muted-foreground/70" />
              Hide column
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export type DataTableColumnOptionsHeaderProps<TData> = {
  table: TanStackTable<TData>
}

function DataTableColumnOptionsHeader<TData>({
  table,
}: DataTableColumnOptionsHeaderProps<TData>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="ml-auto mr-4 flex size-8 data-[state=open]:bg-muted"
        >
          <Settings2Icon className="size-4 shrink-0" aria-hidden="true" />
          <span className="sr-only">Column options</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[150px]">
        <DropdownMenuLabel>Columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {table
          .getAllColumns()
          .filter(
            (column) =>
              typeof column.accessorFn !== "undefined" && column.getCanHide()
          )
          .map((column) => (
            <DropdownMenuCheckboxItem
              key={column.id}
              className="capitalize"
              checked={column.getIsVisible()}
              onCheckedChange={(value) => column.toggleVisibility(!!value)}
            >
              {getColumnTitle(column)}
            </DropdownMenuCheckboxItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function getDataTableSelectedRowCount<TData>(
  table: TanStackTable<TData>,
): number {
  const rowSelection = table.getState().rowSelection
  return Object.values(rowSelection).filter(Boolean).length
}

export type DataTableSelectionProps<TData> = React.PropsWithChildren<{
  table: TanStackTable<TData>
}>

function DataTableBulkActions<TData>({
  table,
  children,
}: DataTableSelectionProps<TData>): React.JSX.Element {
  return (
    <div className="absolute inset-x-0 bottom-12 z-50 mx-auto flex h-[60px] max-w-xl animate-fadeIn items-center justify-between rounded-md border bg-background px-6 py-3 shadow-xl">
      <div className="flex items-center gap-2">{children}</div>
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
    </div>
  )
}

DataTable.displayName = "DataTable"
DataTableBulkActions.displayName = "DataTableBulkActions"
DataTableColumnHeader.displayName = "DataTableColumnHeader"
DataTableColumnOptionsHeader.displayName = "DataTableColumnOptionsHeader"

export {
  DataTable,
  DataTableBulkActions,
  DataTableColumnHeader,
  DataTableColumnOptionsHeader,
  DataTableFilter,
  DataTablePagination,
}
