"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import NiceModal from "@ebay/nice-modal-react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { StageView, TagView } from "@workspace/ui/components/entity-label-views";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Page, PageBody } from "@workspace/ui/components/page";
import { PageToolbar, ResponsivePageToolbarFilters } from "@workspace/ui/components/page-toolbar";
import {
  ResponsivePageAction,
  ResponsivePageActions,
} from "@workspace/ui/components/responsive-page-actions";
import { IconForAdd } from "@workspace/ui/components/icon-for";
import { responsiveLayout } from "@workspace/ui/lib/responsive-layout";
import { PageHeaderInOrg } from "@/common/ui/page-header-in-org";
import { exportContactsCsvAction } from "../data/contact-csv-actions";
import { listContactStagesAction } from "../../contact-stage/data/contact-stage-actions";
import { listContactTagsAction } from "../../contact-tag/data/contact-tag-actions";
import { listContactSegmentsAction } from "../../contact-segment/data/contact-segment-actions";
import { SaveContactSegmentButtonModal } from "../../contact-segment/ui/save-contact-segment-button-modal";
import { AddContactButtonModal } from "./add-contact-button-modal";
import { openAddContactFlow, type AddContactResult } from "./add-contact-flow";
import { CsvImportDialog } from "./csv-import-dialog";
import { ContactsList, type ContactsListQuery } from "./contacts-list";

const EMPTY_QUERY: ContactsListQuery = {};

function hasActiveFilters(query: ContactsListQuery) {
  return Boolean(query.search || query.stageId || query.tagIds?.length || query.segmentId);
}

function activeFilterCount(query: ContactsListQuery) {
  let count = 0;
  if (query.segmentId) count += 1;
  if (query.stageId) count += 1;
  if (query.tagIds?.length) count += 1;
  return count;
}

export function ContactsPageContent({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const [query, setQuery] = useState<ContactsListQuery>(EMPTY_QUERY);
  const [searchInput, setSearchInput] = useState("");
  const [stages, setStages] = useState<{ id: string; name: string; color: string }[]>([]);
  const [tags, setTags] = useState<{ id: string; name: string; color: string }[]>([]);
  const [segments, setSegments] = useState<{ id: string; name: string }[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = () => setRefreshToken((t) => t + 1);

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
  }, []);

  function applyQuery(patch: Partial<ContactsListQuery>) {
    setQuery((prev) => ({ ...prev, ...patch }));
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
    refresh();
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

  const filterActions = hasActiveFilters(query) ? (
    <>
      <Button variant="ghost" size="sm" className="h-9" onClick={handleClearFilters}>
        Clear filters
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-9"
        onClick={() => void handleSaveSegment()}
      >
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
                  <CsvImportDialog onImported={refresh} />
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
        <ContactsList query={query} orgSlug={orgSlug} refreshToken={refreshToken} />
      </PageBody>
    </Page>
  );
}
