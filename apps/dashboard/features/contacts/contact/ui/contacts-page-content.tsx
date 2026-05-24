"use client";

import { useState, useEffect, useTransition, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import NiceModal from "@ebay/nice-modal-react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Badge } from "@workspace/ui/components/badge";
import { StageView, TagView } from "@workspace/ui/components/entity-label-views";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Page, PageBody } from "@workspace/ui/components/page";
import { PageToolbar, ResponsivePageToolbarFilters } from "@workspace/ui/components/page-toolbar";
import {
  DataList,
  DataListCard,
  DataListCardHeader,
  DataListCardMeta,
  ResponsiveDataView,
} from "@workspace/ui/components/responsive-data-view";
import {
  ResponsivePageAction,
  ResponsivePageActions,
} from "@workspace/ui/components/responsive-page-actions";
import { TagListCompact } from "@workspace/ui/components/tag-list-compact";
import { IconForAdd, IconForMore } from "@workspace/ui/components/icon-for";
import { responsiveLayout } from "@workspace/ui/lib/responsive-layout";
import { PageHeaderInOrg } from "@/common/ui/page-header-in-org";
import type { ContactListFilters } from "@workspace/contacts/schemas/contact-schemas";
import { listContactsAction, archiveContactAction } from "../data/contact-actions";
import { exportContactsCsvAction } from "../data/contact-csv-actions";
import { listContactStagesAction } from "../../contact-stage/data/contact-stage-actions";
import { listContactTagsAction } from "../../contact-tag/data/contact-tag-actions";
import {
  listContactSegmentsAction,
  listContactsForSegmentAction,
} from "../../contact-segment/data/contact-segment-actions";
import { SaveContactSegmentButtonModal } from "../../contact-segment/ui/save-contact-segment-button-modal";
import { AddContactButtonModal } from "./add-contact-button-modal";
import { openAddContactFlow, type AddContactResult } from "./add-contact-flow";
import { CsvImportDialog } from "./csv-import-dialog";

type Contact = NonNullable<
  Extract<Awaited<ReturnType<typeof listContactsAction>>, { success: true }>["data"]
>["rows"][number];

type ListQuery = Partial<ContactListFilters> & { segmentId?: string };

const EMPTY_QUERY: ListQuery = {};

function hasActiveFilters(query: ListQuery) {
  return Boolean(
    query.search ||
      query.stageId ||
      query.tagIds?.length ||
      query.segmentId,
  );
}

function activeFilterCount(query: ListQuery) {
  let count = 0;
  if (query.segmentId) count += 1;
  if (query.stageId) count += 1;
  if (query.tagIds?.length) count += 1;
  return count;
}

function ContactRowActions({
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

export function ContactsPageContent({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState<ListQuery>(EMPTY_QUERY);
  const [searchInput, setSearchInput] = useState("");
  const [stages, setStages] = useState<{ id: string; name: string; color: string }[]>([]);
  const [tags, setTags] = useState<{ id: string; name: string; color: string }[]>([]);
  const [segments, setSegments] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadGenRef = useRef(0);

  const load = useCallback((nextQuery: ListQuery) => {
    const gen = ++loadGenRef.current;
    startTransition(async () => {
      const result = nextQuery.segmentId
        ? await listContactsForSegmentAction(nextQuery.segmentId, { pageSize: 100 })
        : await listContactsAction({
            search: nextQuery.search,
            stageId: nextQuery.stageId,
            tagIds: nextQuery.tagIds,
            pageSize: 100,
          });
      if (result.success && gen === loadGenRef.current) {
        setContacts(result.data.rows);
      }
    });
  }, []);

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
    load(EMPTY_QUERY);
  }, [load]);

  function applyQuery(patch: Partial<ListQuery>) {
    const next = { ...query, ...patch };
    setQuery(next);
    load(next);
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
    load(EMPTY_QUERY);
  }

  async function handleArchive(id: string) {
    const result = await archiveContactAction(id);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setError(null);
    load(query);
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
    load(query);
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

  const filterActions =
    hasActiveFilters(query) ? (
      <>
        <Button variant="ghost" size="sm" className="h-9" onClick={handleClearFilters}>
          Clear filters
        </Button>
        <Button variant="outline" size="sm" className="h-9" onClick={() => void handleSaveSegment()}>
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
                  <CsvImportDialog onImported={() => load(query)} />
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
        {error && <p className="text-sm text-destructive">{error}</p>}
        <ResponsiveDataView
          mobile={
            isPending ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
            ) : contacts.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No contacts match these filters.
              </p>
            ) : (
              <DataList>
                {contacts.map((c) => (
                  <DataListCard
                    key={c.id}
                    onActivate={() => router.push(`/${orgSlug}/contacts/${c.id}`)}
                  >
                    <DataListCardHeader
                      actions={
                        <ContactRowActions
                          onView={() => router.push(`/${orgSlug}/contacts/${c.id}`)}
                          onArchive={() => void handleArchive(c.id)}
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
                  </DataListCard>
                ))}
              </DataList>
            )
          }
          desktop={
            <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className={responsiveLayout.hideBelowMdTableCell}>Kind</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className={responsiveLayout.hideBelowLgTableCell}>Stage</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : contacts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No contacts match these filters.
                  </TableCell>
                </TableRow>
              ) : (
                contacts.map((c) => (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/${orgSlug}/contacts/${c.id}`)}
                  >
                    <TableCell className="max-w-[12rem] truncate font-medium">
                      {c.displayName}
                    </TableCell>
                    <TableCell className={responsiveLayout.hideBelowMdTableCell}>
                      <Badge variant="outline">{c.kind}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate text-muted-foreground">
                      {c.primaryEmail ?? "—"}
                    </TableCell>
                    <TableCell className={responsiveLayout.hideBelowLgTableCell}>
                      {c.stage ? (
                        <StageView name={c.stage.name} color={c.stage.color} />
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <TagListCompact
                        tags={c.tags.map((a) => ({
                          id: a.tagId,
                          name: a.tag.name,
                          color: a.tag.color,
                        }))}
                      />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <ContactRowActions
                        onView={() => router.push(`/${orgSlug}/contacts/${c.id}`)}
                        onArchive={() => void handleArchive(c.id)}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
            </div>
          }
        />
      </PageBody>
    </Page>
  );
}
