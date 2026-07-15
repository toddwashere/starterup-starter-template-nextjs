"use client";

import { useEffect, useState } from "react";
import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  MEMBER_ASSIGNABLE_ORG_ROLE_IDS,
  ORG_ROLE_CATALOG,
  isOrgRoleId,
  type OrgRoleId,
} from "@workspace/auth/org-roles";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Label } from "@workspace/ui/components/label";
import { Badge } from "@workspace/ui/components/badge";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { resolveAndHideModal } from "@/common/ui/nice-modal-helpers";
import { replaceMemberRolesAction } from "../data/org-actions";

export type EditMemberRolesButtonModalProps = {
  organizationId: string;
  orgSlug: string;
  memberId: string;
  memberName: string;
  currentRoles: string[];
};

const REPAIR_MESSAGE =
  "This member has a role that is no longer recognized. Contact support to repair it before assigning new roles.";

export const EditMemberRolesButtonModal = NiceModal.create(
  ({
    organizationId,
    orgSlug,
    memberId,
    memberName,
    currentRoles,
  }: EditMemberRolesButtonModalProps) => {
    const modal = useModal();
    const queryClient = useQueryClient();
    const [selectedRoles, setSelectedRoles] = useState<OrgRoleId[]>(() =>
      MEMBER_ASSIGNABLE_ORG_ROLE_IDS.filter((role) =>
        currentRoles.includes(role),
      ),
    );
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      if (!modal.visible) return;
      setSelectedRoles(
        MEMBER_ASSIGNABLE_ORG_ROLE_IDS.filter((role) =>
          currentRoles.includes(role),
        ),
      );
      setError(null);
      setIsSubmitting(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [modal.visible]);

    const unknownRoles = currentRoles.filter((role) => !isOrgRoleId(role));
    const hasUnknownRoles = unknownRoles.length > 0;

    function toggleRole(role: OrgRoleId, checked: boolean) {
      setSelectedRoles((previous) =>
        checked ? [...previous, role] : previous.filter((r) => r !== role),
      );
    }

    async function handleSubmit() {
      if (selectedRoles.length === 0 || hasUnknownRoles || isSubmitting) {
        return;
      }
      setIsSubmitting(true);
      setError(null);
      try {
        const result = await replaceMemberRolesAction({
          organizationId,
          memberId,
          roles: selectedRoles,
        });
        if (!result.success) {
          setError(result.error.message);
          return;
        }
        if (result.data.status === "failed") {
          setError(result.data.message);
          return;
        }
        await queryClient.invalidateQueries({
          queryKey: ["members", orgSlug],
        });
        await queryClient.invalidateQueries({
          queryKey: ["member-management-context", organizationId],
        });
        resolveAndHideModal(modal, result.data);
      } finally {
        setIsSubmitting(false);
      }
    }

    return (
      <Dialog
        open={modal.visible}
        onOpenChange={(open) => {
          if (!open) modal.hide();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit roles</DialogTitle>
            <DialogDescription>
              Update the roles for {memberName}.
            </DialogDescription>
          </DialogHeader>

          {hasUnknownRoles ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Current roles</Label>
                <div className="flex flex-wrap gap-1">
                  {unknownRoles.map((role) => (
                    <Badge key={role} variant="outline">
                      {role}
                    </Badge>
                  ))}
                </div>
              </div>
              <Alert variant="destructive">
                <AlertDescription>{REPAIR_MESSAGE}</AlertDescription>
              </Alert>
            </div>
          ) : (
            <div className="space-y-3">
              <Label>Roles</Label>
              {MEMBER_ASSIGNABLE_ORG_ROLE_IDS.map((role) => {
                const meta = ORG_ROLE_CATALOG[role];
                return (
                  <div key={role} className="flex items-start gap-2">
                    <Checkbox
                      id={`edit-role-${role}`}
                      checked={selectedRoles.includes(role)}
                      onCheckedChange={(checked) =>
                        toggleRole(role, checked === true)
                      }
                    />
                    <div className="grid gap-0.5">
                      <Label
                        htmlFor={`edit-role-${role}`}
                        className="font-normal"
                      >
                        {meta.label}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {meta.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => modal.hide()}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleSubmit()}
              disabled={
                selectedRoles.length === 0 || hasUnknownRoles || isSubmitting
              }
            >
              {isSubmitting ? "Saving..." : "Save roles"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
);
