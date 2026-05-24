"use client";

import type { Table as TanStackTable } from "@tanstack/react-table";
import { Badge } from "@workspace/ui/components/badge";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { StageView } from "@workspace/ui/components/entity-label-views";
import {
  DataList,
  DataListCard,
  DataListCardHeader,
  DataListCardMeta,
} from "@workspace/ui/components/responsive-data-view";
import { TagListCompact } from "@workspace/ui/components/tag-list-compact";
import {
  ContactRowActions,
  type Contact,
  type ContactTableMeta,
} from "./contacts-data-table";

export function ContactsMobileList({
  table,
  isPending,
}: {
  table: TanStackTable<Contact>;
  isPending: boolean;
}) {
  const meta = table.options.meta as ContactTableMeta;
  const rows = table.getRowModel().rows;

  if (isPending) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No contacts match these filters.
      </p>
    );
  }

  return (
    <DataList>
      {rows.map((row) => {
        const c = row.original;
        return (
          <DataListCard key={c.id} onActivate={() => meta.onView(c.id)}>
            <div className="flex items-start gap-3">
              <Checkbox
                aria-label="Select contact"
                className="mt-1"
                checked={row.getIsSelected()}
                onCheckedChange={(value) => row.toggleSelected(!!value)}
                onClick={(e) => e.stopPropagation()}
              />
              <div className="min-w-0 flex-1 space-y-1.5">
                <DataListCardHeader
                  actions={
                    <ContactRowActions
                      onView={() => meta.onView(c.id)}
                      onArchive={() => meta.onArchive(c.id)}
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
              </div>
            </div>
          </DataListCard>
        );
      })}
    </DataList>
  );
}
