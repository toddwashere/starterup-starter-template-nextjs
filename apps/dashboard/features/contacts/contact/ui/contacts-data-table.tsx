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
import type { listContactsAction } from "../data/contact-actions";

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
      enableSorting: false,
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
