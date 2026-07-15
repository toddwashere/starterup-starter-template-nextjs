"use client";

import { useEffect, useState } from "react";
import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { useQueryClient } from "@tanstack/react-query";
import { ORG_ROLE_CATALOG, isOrgRoleId } from "@workspace/auth/org-roles";
import { Button } from "@workspace/ui/components/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { resolveAndHideModal } from "@/common/ui/nice-modal-helpers";
import { transferOwnershipAction } from "../data/org-actions";

export type TransferOwnershipConfirmDialogProps = {
  organizationId: string;
  orgSlug: string;
  targetMemberId: string;
  targetName: string;
  /** The current owner's (the acting user's) complete role set. */
  actorRoles: string[];
};

function roleLabel(role: string): string {
  return isOrgRoleId(role) ? ORG_ROLE_CATALOG[role].label : role;
}

export const TransferOwnershipConfirmDialog = NiceModal.create(
  ({
    organizationId,
    orgSlug,
    targetMemberId,
    targetName,
    actorRoles,
  }: TransferOwnershipConfirmDialogProps) => {
    const modal = useModal();
    const queryClient = useQueryClient();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      if (!modal.visible) return;
      setError(null);
      setIsSubmitting(false);
    }, [modal.visible]);

    // Mirrors the fallback in `transferOrganizationOwnership`: the former
    // owner keeps whatever non-owner roles they already held, falling back
    // to admin only when owner was their sole role.
    const remainingRoles = actorRoles.filter((role) => role !== "owner");
    const isSoleOwner = remainingRoles.length === 0;

    async function handleSubmit() {
      if (isSubmitting) return;
      setIsSubmitting(true);
      setError(null);
      try {
        const result = await transferOwnershipAction({
          organizationId,
          targetMemberId,
        });
        if (!result.success) {
          setError(result.error.message);
          return;
        }
        await queryClient.invalidateQueries({
          queryKey: ["organization", orgSlug],
        });
        await queryClient.invalidateQueries({
          queryKey: ["members", orgSlug],
        });
        await queryClient.invalidateQueries({
          queryKey: ["member-management-context", organizationId],
        });
        resolveAndHideModal(modal, true);
      } finally {
        setIsSubmitting(false);
      }
    }

    return (
      <AlertDialog
        open={modal.visible}
        onOpenChange={(open) => {
          if (!open) modal.hide();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Transfer ownership</AlertDialogTitle>
            <AlertDialogDescription>
              Transfer ownership of this organization to{" "}
              <span className="font-medium">{targetName}</span>?
            </AlertDialogDescription>
          </AlertDialogHeader>

          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              <span className="font-medium">{targetName}</span> will become
              the owner, keeping their existing roles.
            </li>
            <li>You will lose the owner role.</li>
            <li>
              {isSoleOwner
                ? "Since owner is currently your only role, you will become an admin."
                : `You will keep your other role${
                    remainingRoles.length > 1 ? "s" : ""
                  }: ${remainingRoles.map(roleLabel).join(", ")}.`}
            </li>
          </ul>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>
              Cancel
            </AlertDialogCancel>
            <Button onClick={() => void handleSubmit()} disabled={isSubmitting}>
              {isSubmitting ? "Transferring..." : "Transfer ownership"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  },
);
