"use client";

import { useCallback, useMemo, useState } from "react";
import {
  getCoreRowModel,
  useReactTable,
  type RowSelectionState,
} from "@tanstack/react-table";
import type { MemberManagementReason } from "@workspace/auth/org-roles";
import { getDataTableSelectedRowCount } from "@workspace/ui/components/data-table";
import { ResponsiveDataView } from "@workspace/ui/components/responsive-data-view";
import {
  createMemberColumns,
  MembersDataTable,
  type MembersTableMeta,
} from "./members-data-table";
import { MembersMobileList } from "./members-mobile-list";
import { MembersBulkActions } from "./members-bulk-actions";

/** The per-member decision from `getMemberManagementContext` (auth service). */
export type MemberManagement = {
  allowed: boolean;
  reason: MemberManagementReason | null;
  canTransferOwnership: boolean;
};

/** One member row plus its resolved role-management eligibility. */
export type MemberRow = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  roles: string[];
  createdAt: Date;
  management: MemberManagement;
};

/** Outcome of a bulk add/remove-roles request, reported back to `MembersList`. */
export type BulkEditRolesResult = {
  failedMemberIds: string[];
};

export type MembersListProps = {
  members: MemberRow[];
  onEditRoles: (member: MemberRow) => void;
  onTransferOwnership: (member: MemberRow) => void;
  onRemove: (member: MemberRow) => void;
  /**
   * Invoked with the bulk operation and the selected member IDs. May return
   * a `BulkEditRolesResult` (sync or async) — when it does, `MembersList`
   * clears the selection down to only the failed member IDs; unchanged/
   * succeeded IDs are deselected. Returning nothing leaves selection as-is,
   * for callers (e.g. one that opens a modal and manages the result itself
   * via `NiceModal.show`, added in Task 7) that clear selection on their own
   * terms.
   */
  onBulkEditRoles: (
    operation: "add" | "remove",
    selectedMemberIds: string[],
  ) => BulkEditRolesResult | Promise<BulkEditRolesResult> | void;
};

/**
 * Responsive, selectable members list. Desktop (table) and mobile (cards)
 * are two renderings of ONE TanStack table instance/`RowSelectionState`, so
 * selecting a row in either view is reflected in both. Row actions
 * (edit roles / transfer ownership / remove) and the bulk-edit handler are
 * all callback props — this component never imports the Task 7/8 modals, so
 * it stays render-testable before those modals exist.
 */
export function MembersList({
  members,
  onEditRoles,
  onTransferOwnership,
  onRemove,
  onBulkEditRoles,
}: MembersListProps) {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const columns = useMemo(() => createMemberColumns(), []);

  const table = useReactTable<MemberRow>({
    data: members,
    columns,
    state: { rowSelection },
    getRowId: (row) => row.id,
    enableRowSelection: (row) => row.original.management.allowed,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    meta: {
      onEditRoles,
      onTransferOwnership,
      onRemove,
    } satisfies MembersTableMeta,
  });

  const handleBulkEditRoles = useCallback(
    async (operation: "add" | "remove", selectedMemberIds: string[]) => {
      const result = await onBulkEditRoles(operation, selectedMemberIds);
      if (!result) {
        return;
      }
      const failedIds = new Set(result.failedMemberIds);
      setRowSelection((previous) => {
        const next: RowSelectionState = {};
        for (const id of Object.keys(previous)) {
          if (previous[id] && failedIds.has(id)) {
            next[id] = true;
          }
        }
        return next;
      });
    },
    [onBulkEditRoles],
  );

  return (
    <div className="relative flex flex-col gap-4 overflow-hidden">
      <ResponsiveDataView
        mobile={<MembersMobileList table={table} />}
        desktop={<MembersDataTable table={table} />}
      />
      {getDataTableSelectedRowCount(table) > 0 ? (
        <MembersBulkActions table={table} onBulkEditRoles={handleBulkEditRoles} />
      ) : null}
    </div>
  );
}
