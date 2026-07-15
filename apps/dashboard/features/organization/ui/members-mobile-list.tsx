"use client";

import type { Table as TanStackTable } from "@tanstack/react-table";
import { formatDate } from "@workspace/common";
import { Badge } from "@workspace/ui/components/badge";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  DataList,
  DataListCard,
  DataListCardHeader,
  DataListCardMeta,
} from "@workspace/ui/components/responsive-data-view";
import { getMemberManagementPresentation } from "./member-management-eligibility";
import { MemberRowActions, type MembersTableMeta } from "./members-data-table";
import type { MemberRow } from "./members-list";

const roleBadgeVariant: Record<string, "default" | "secondary" | "outline"> = {
  owner: "default",
  admin: "secondary",
  member: "outline",
};

/**
 * Mobile card list mirroring the desktop table: same shared TanStack row
 * model drives selection and row actions, so toggling a row here is
 * reflected on the desktop table (and vice versa).
 */
export function MembersMobileList({
  table,
}: {
  table: TanStackTable<MemberRow>;
}) {
  const meta = table.options.meta as MembersTableMeta;
  const rows = table.getRowModel().rows;

  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No members yet.
      </p>
    );
  }

  return (
    <DataList>
      {rows.map((row) => {
        const member = row.original;
        const presentation = getMemberManagementPresentation(
          member.management.reason,
        );
        const roles = member.roles.length > 0 ? member.roles : ["member"];

        return (
          <DataListCard
            key={member.id}
            data-testid={`member-row-mobile-${member.id}`}
          >
            <div className="flex items-start gap-3">
              <Checkbox
                aria-label="Select member"
                className="mt-1"
                checked={row.getIsSelected()}
                disabled={!row.getCanSelect()}
                onCheckedChange={(value) => row.toggleSelected(!!value)}
                onClick={(event) => event.stopPropagation()}
              />
              <div className="min-w-0 flex-1 space-y-1.5">
                <DataListCardHeader
                  actions={
                    <MemberRowActions
                      member={member}
                      onEditRoles={meta.onEditRoles}
                      onTransferOwnership={meta.onTransferOwnership}
                      onRemove={meta.onRemove}
                    />
                  }
                >
                  {member.name}
                </DataListCardHeader>
                <DataListCardMeta>{member.email}</DataListCardMeta>
                <div className="flex flex-wrap items-center gap-2">
                  {roles.map((role) => (
                    <Badge key={role} variant={roleBadgeVariant[role] ?? "outline"}>
                      {role}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Joined {formatDate(member.createdAt)}
                </p>
                {presentation.protectedMessage ? (
                  <p className="text-xs text-muted-foreground">
                    {presentation.protectedMessage}
                  </p>
                ) : null}
              </div>
            </div>
          </DataListCard>
        );
      })}
    </DataList>
  );
}
