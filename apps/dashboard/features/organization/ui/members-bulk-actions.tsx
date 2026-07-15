"use client";

import type { Table as TanStackTable } from "@tanstack/react-table";
import { Button } from "@workspace/ui/components/button";
import { DataTableBulkActions } from "@workspace/ui/components/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { IconForMore, IconForSecurity } from "@workspace/ui/components/icon-for";
import type { MemberRow } from "./members-list";

function getSelectedMemberIds(table: TanStackTable<MemberRow>): string[] {
  const rowSelection = table.getState().rowSelection;
  return Object.keys(rowSelection).filter((id) => rowSelection[id]);
}

/**
 * Bulk action bar for the members list selection. Does NOT import the bulk
 * role-edit modal (Task 7 hasn't landed yet) — it collects the selected
 * member IDs and hands them to the injected `onBulkEditRoles` callback,
 * which the page (Task 9) wires up to `NiceModal.show(...)`.
 */
export function MembersBulkActions({
  table,
  onBulkEditRoles,
}: {
  table: TanStackTable<MemberRow>;
  onBulkEditRoles: (
    operation: "add" | "remove",
    selectedMemberIds: string[],
  ) => void;
}) {
  function handle(operation: "add" | "remove") {
    onBulkEditRoles(operation, getSelectedMemberIds(table));
  }

  return (
    <DataTableBulkActions table={table}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <IconForMore className="mr-2" />
            Actions
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => handle("add")}>
            <IconForSecurity className="mr-2" />
            Add roles
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handle("remove")}>
            <IconForSecurity className="mr-2" />
            Remove roles
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </DataTableBulkActions>
  );
}
