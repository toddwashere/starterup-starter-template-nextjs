"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authClient } from "@workspace/auth/client";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import { IconForMore, IconForSecurity, IconForRemove } from "@workspace/ui/components/icon-for";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Page, PageBody } from "@workspace/ui/components/page";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { PageHeaderInOrg } from "@/common/ui/page-header-in-org";
import { getMemberManageContextAction } from "../data/org-permission-actions";
import { useCurrentOrg } from "./org-provider";
import { InviteMemberDialog } from "./invite-member-dialog";
import { PendingInvitations } from "./pending-invitations";
import { UpdateMemberRoleDialog } from "./update-member-role-dialog";
import { RemoveMemberDialog } from "./remove-member-dialog";

const roleBadgeVariant: Record<string, "default" | "secondary" | "outline"> = {
  owner: "default",
  admin: "secondary",
  member: "outline",
};

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function MembersPageContent({ orgSlug }: { orgSlug: string }) {
  const { organization, members, invitations, isLoading } = useCurrentOrg();
  const { data: session } = authClient.useSession();

  const [roleDialog, setRoleDialog] = useState<{
    open: boolean;
    memberId: string;
    memberName: string;
    currentRoles: string[];
  }>({ open: false, memberId: "", memberName: "", currentRoles: [] });

  const [removeDialog, setRemoveDialog] = useState<{
    open: boolean;
    memberId: string;
    memberName: string;
  }>({ open: false, memberId: "", memberName: "" });

  const showSkeleton = isLoading || !organization;

  const orgId = organization?.id;
  const { data: manageCtx } = useQuery({
    queryKey: ["member-manage-context", orgId],
    queryFn: () => getMemberManageContextAction(orgId!),
    enabled: !!orgId,
  });
  const canManageMembers = manageCtx?.canManage ?? false;

  const ownerExistsElsewhere = members.some(
    (m) => m.id !== roleDialog.memberId && m.roles.includes("owner"),
  );

  return (
    <Page className="flex min-h-0 flex-1 flex-col">
      <PageHeaderInOrg
        title="Members"
        description="Manage your organization's team members."
        actions={
          showSkeleton ? (
            <Skeleton className="h-9 w-36" />
          ) : canManageMembers ? (
            <InviteMemberDialog
              organizationId={organization!.id}
              orgSlug={orgSlug}
            />
          ) : undefined
        }
      />
      <PageBody className="space-y-6 p-6">
      {showSkeleton ? (
        <div className="space-y-2 rounded-md border p-0">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-none first:rounded-t-md last:rounded-b-md" />
          ))}
        </div>
      ) : (
      <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
              {canManageMembers && (
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => {
              const isCurrentUser = member.userId === session?.user?.id;
              const isOwner = member.roles.includes("owner");
              const memberRoles = member.roles.length > 0 ? member.roles : ["member"];

              return (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarImage
                          src={member.user.image ?? undefined}
                          alt={member.user.name ?? ""}
                        />
                        <AvatarFallback>
                          {getInitials(member.user.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-medium">
                          {member.user.name}
                          {isCurrentUser && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              (you)
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {member.user.email}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {memberRoles.map((role) => (
                        <Badge
                          key={role}
                          variant={roleBadgeVariant[role] ?? "outline"}
                        >
                          {role}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(member.createdAt).toLocaleDateString()}
                  </TableCell>
                  {canManageMembers && (
                    <TableCell>
                      {!isCurrentUser && !isOwner && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <IconForMore />
                              <span className="sr-only">Actions</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() =>
                                setRoleDialog({
                                  open: true,
                                  memberId: member.id,
                                  memberName: member.user.name ?? "Member",
                                  currentRoles: memberRoles,
                                })
                              }
                            >
                              <IconForSecurity className="mr-2" />
                              Change Role
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onSelect={() =>
                                setRemoveDialog({
                                  open: true,
                                  memberId: member.id,
                                  memberName: member.user.name ?? "Member",
                                })
                              }
                            >
                              <IconForRemove className="mr-2" />
                              Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {canManageMembers && (
        <PendingInvitations
          invitations={invitations}
          orgSlug={orgSlug}
          canManageInvitations={canManageMembers}
        />
      )}
      </>
      )}

      {!showSkeleton && (
        <>
      <UpdateMemberRoleDialog
        open={roleDialog.open}
        onOpenChange={(open) =>
          setRoleDialog((prev) => ({ ...prev, open }))
        }
        memberId={roleDialog.memberId}
        memberName={roleDialog.memberName}
        currentRoles={roleDialog.currentRoles}
        ownerExistsElsewhere={ownerExistsElsewhere}
        organizationId={organization!.id}
        orgSlug={orgSlug}
      />

      <RemoveMemberDialog
        open={removeDialog.open}
        onOpenChange={(open) =>
          setRemoveDialog((prev) => ({ ...prev, open }))
        }
        memberId={removeDialog.memberId}
        memberName={removeDialog.memberName}
        organizationId={organization!.id}
        orgSlug={orgSlug}
      />
        </>
      )}
      </PageBody>
    </Page>
  );
}
