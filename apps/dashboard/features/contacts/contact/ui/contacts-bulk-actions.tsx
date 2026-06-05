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
  IconForCampaigns,
} from "@workspace/ui/components/icon-for";
import { toast } from "@workspace/ui/components/sonner";
import { exportContactsByIdsAction } from "../data/contact-csv-actions";
import { AddContactsToSegmentButtonModal } from "../../contact-segment/ui/add-contacts-to-segment-button-modal";
import { StartFollowUpButtonModal } from "@/features/campaigns/contact-integration/ui/start-follow-up-button-modal";
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
