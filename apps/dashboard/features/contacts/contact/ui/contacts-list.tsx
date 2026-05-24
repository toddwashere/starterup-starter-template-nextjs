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

  // Filters changed -> go back to the first page. Selection is intentionally NOT
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
