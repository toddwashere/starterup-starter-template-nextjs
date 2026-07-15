"use client";

import type { ColumnDef, Table as TanStackTable } from "@tanstack/react-table";
import { formatDate } from "@workspace/common";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar";
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
import {
  IconForKey,
  IconForMore,
  IconForRemove,
  IconForSecurity,
} from "@workspace/ui/components/icon-for";
import { getMemberManagementPresentation } from "./member-management-eligibility";
import type { MemberRow } from "./members-list";

/** Row-level action handlers, threaded through `table.options.meta`. */
export type MembersTableMeta = {
  onEditRoles: (member: MemberRow) => void;
  onTransferOwnership: (member: MemberRow) => void;
  onRemove: (member: MemberRow) => void;
};

const roleBadgeVariant: Record<string, "default" | "secondary" | "outline"> = {
  owner: "default",
  admin: "secondary",
  member: "outline",
};

function getInitials(name: string): string {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return initials || "?";
}

/**
 * Row action dropdown shared by the desktop table and mobile cards. Shows
 * Edit roles / Transfer ownership only when the per-row management decision
 * allows them; Remove is always offered. When neither role action is
 * available, the protected-state copy is rendered next to the menu trigger.
 */
export function MemberRowActions({
  member,
  onEditRoles,
  onTransferOwnership,
  onRemove,
}: {
  member: MemberRow;
  onEditRoles: (member: MemberRow) => void;
  onTransferOwnership: (member: MemberRow) => void;
  onRemove: (member: MemberRow) => void;
}) {
  const presentation = getMemberManagementPresentation(member.management.reason);
  const canTransfer = member.management.canTransferOwnership;
  const hasRoleAction = presentation.editable || canTransfer;

  return (
    <div
      className="flex items-center justify-end gap-2"
      onClick={(event) => event.stopPropagation()}
    >
      {!hasRoleAction && presentation.protectedMessage ? (
        <span className="text-xs text-muted-foreground">
          {presentation.protectedMessage}
        </span>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon">
            <IconForMore />
            <span className="sr-only">Actions for {member.name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {presentation.editable ? (
            <DropdownMenuItem onClick={() => onEditRoles(member)}>
              <IconForSecurity className="mr-2" />
              Edit roles
            </DropdownMenuItem>
          ) : null}
          {canTransfer ? (
            <DropdownMenuItem onClick={() => onTransferOwnership(member)}>
              <IconForKey className="mr-2" />
              Transfer ownership
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            className="text-destructive"
            onClick={() => onRemove(member)}
          >
            <IconForRemove className="mr-2" />
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function createMemberColumns(): ColumnDef<MemberRow>[] {
  return [
    createDataTableSelectColumn<MemberRow>(),
    {
      id: "member",
      header: "Member",
      cell: ({ row }) => {
        const member = row.original;
        return (
          <div className="flex items-center gap-3">
            <Avatar className="size-8">
              <AvatarImage src={member.image ?? undefined} alt={member.name} />
              <AvatarFallback>{getInitials(member.name)}</AvatarFallback>
            </Avatar>
            <div>
              <div className="font-medium">{member.name}</div>
              <div className="text-sm text-muted-foreground">{member.email}</div>
            </div>
          </div>
        );
      },
    },
    {
      id: "roles",
      header: "Role",
      cell: ({ row }) => {
        const roles = row.original.roles.length > 0 ? row.original.roles : ["member"];
        return (
          <div className="flex flex-wrap gap-1">
            {roles.map((role) => (
              <Badge key={role} variant={roleBadgeVariant[role] ?? "outline"}>
                {role}
              </Badge>
            ))}
          </div>
        );
      },
    },
    {
      id: "createdAt",
      header: "Joined",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {formatDate(row.original.createdAt)}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row, table }) => {
        const meta = table.options.meta as MembersTableMeta;
        return (
          <MemberRowActions
            member={row.original}
            onEditRoles={meta.onEditRoles}
            onTransferOwnership={meta.onTransferOwnership}
            onRemove={meta.onRemove}
          />
        );
      },
    },
  ];
}

export function MembersDataTable({
  table,
}: {
  table: TanStackTable<MemberRow>;
}) {
  return (
    <div className="rounded-md border">
      <DataTable
        table={table}
        getRowTestId={(row) => `member-row-desktop-${row.original.id}`}
        emptyState={
          <span className="text-muted-foreground">No members yet.</span>
        }
      />
    </div>
  );
}
