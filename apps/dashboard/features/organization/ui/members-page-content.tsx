"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import NiceModal from "@ebay/nice-modal-react";
import { Button } from "@workspace/ui/components/button";
import { IconForInvite } from "@workspace/ui/components/icon-for";
import { Page, PageBody } from "@workspace/ui/components/page";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { PageHeaderInOrg } from "@/common/ui/page-header-in-org";
import { getMemberManagementContextAction } from "../data/org-permission-actions";
import { useCurrentOrg } from "./org-provider";
import {
  MembersList,
  type BulkEditRolesResult,
  type MemberRow,
} from "./members-list";
import { EditMemberRolesButtonModal } from "./edit-member-roles-button-modal";
import {
  BulkEditMemberRolesButtonModal,
  type BulkEditMemberRolesResult,
  type SelectedMemberSummary,
} from "./bulk-edit-member-roles-button-modal";
import { InviteMemberButtonModal } from "./invite-member-button-modal";
import { TransferOwnershipConfirmDialog } from "./transfer-ownership-confirm-dialog";
import { PendingInvitations } from "./pending-invitations";
import { RemoveMemberDialog } from "./remove-member-dialog";

/**
 * Conservative fallback for a member ID that `getMemberManagementContext`
 * omitted from its response (only expected transiently, e.g. a member row
 * that no longer resolves inside the organization). Treats the row as fully
 * protected rather than defaulting to editable.
 */
const FALLBACK_MANAGEMENT: MemberRow["management"] = {
  allowed: false,
  reason: "MISSING_PERMISSION",
  canTransferOwnership: false,
};

export function MembersPageContent({ orgSlug }: { orgSlug: string }) {
  const { organization, members, invitations, isLoading } = useCurrentOrg();

  const [removeDialog, setRemoveDialog] = useState<{
    open: boolean;
    memberId: string;
    memberName: string;
  }>({ open: false, memberId: "", memberName: "" });

  const memberIds = useMemo(
    () => members.map((member) => member.id).sort(),
    [members],
  );

  const { data: managementContext } = useQuery({
    queryKey: ["member-management-context", organization?.id, memberIds],
    queryFn: () =>
      getMemberManagementContextAction(organization!.id, memberIds),
    enabled: Boolean(organization?.id) && memberIds.length > 0,
  });

  const showSkeleton =
    isLoading ||
    !organization ||
    (memberIds.length > 0 && !managementContext);

  const canManageMembers = managementContext?.canManageMembers ?? false;

  const memberRows: MemberRow[] = useMemo(() => {
    if (!managementContext) return [];
    return members.map((member) => ({
      id: member.id,
      name: member.user.name,
      email: member.user.email,
      image: member.user.image,
      roles: member.roles,
      createdAt: member.createdAt,
      management: managementContext.members[member.id] ?? FALLBACK_MANAGEMENT,
    }));
  }, [members, managementContext]);

  function handleEditRoles(member: MemberRow) {
    void NiceModal.show(EditMemberRolesButtonModal, {
      organizationId: organization!.id,
      orgSlug,
      memberId: member.id,
      memberName: member.name,
      currentRoles: member.roles,
    });
  }

  function handleTransferOwnership(member: MemberRow) {
    void NiceModal.show(TransferOwnershipConfirmDialog, {
      organizationId: organization!.id,
      orgSlug,
      targetMemberId: member.id,
      targetName: member.name,
      actorRoles: managementContext?.actorRoles ?? [],
    });
  }

  function handleRemove(member: MemberRow) {
    setRemoveDialog({
      open: true,
      memberId: member.id,
      memberName: member.name,
    });
  }

  async function handleBulkEditRoles(
    operation: "add" | "remove",
    selectedMemberIds: string[],
  ): Promise<BulkEditRolesResult> {
    const selectedMembers: SelectedMemberSummary[] = memberRows
      .filter((member) => selectedMemberIds.includes(member.id))
      .map((member) => ({ id: member.id, name: member.name }));

    return (await NiceModal.show(BulkEditMemberRolesButtonModal, {
      organizationId: organization!.id,
      orgSlug,
      operation,
      selectedMembers,
    })) as BulkEditMemberRolesResult;
  }

  return (
    <Page className="flex min-h-0 flex-1 flex-col">
      <PageHeaderInOrg
        title="Members"
        description="Manage your organization's team members."
        actions={
          showSkeleton ? (
            <Skeleton className="h-9 w-36" />
          ) : canManageMembers ? (
            <Button
              onClick={() =>
                void NiceModal.show(InviteMemberButtonModal, {
                  organizationId: organization!.id,
                  orgSlug,
                })
              }
            >
              <IconForInvite className="mr-2" />
              Invite member
            </Button>
          ) : undefined
        }
      />
      <PageBody className="space-y-6 p-6">
        {showSkeleton ? (
          <div className="space-y-2 rounded-md border p-0">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton
                key={i}
                className="h-16 w-full rounded-none first:rounded-t-md last:rounded-b-md"
              />
            ))}
          </div>
        ) : (
          <>
            <MembersList
              members={memberRows}
              onEditRoles={handleEditRoles}
              onTransferOwnership={handleTransferOwnership}
              onRemove={handleRemove}
              onBulkEditRoles={handleBulkEditRoles}
            />

            {canManageMembers && (
              <PendingInvitations
                invitations={invitations}
                orgSlug={orgSlug}
                canManageInvitations={canManageMembers}
              />
            )}

            <RemoveMemberDialog
              open={removeDialog.open}
              onOpenChange={(open) =>
                setRemoveDialog((prev) => ({ ...prev, open }))
              }
              memberId={removeDialog.memberId}
              memberName={removeDialog.memberName}
              organizationId={organization.id}
              orgSlug={orgSlug}
            />
          </>
        )}
      </PageBody>
    </Page>
  );
}
