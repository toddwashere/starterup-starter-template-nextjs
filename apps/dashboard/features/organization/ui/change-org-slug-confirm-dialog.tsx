"use client";

import NiceModal, { useModal } from "@ebay/nice-modal-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Button } from "@workspace/ui/components/button";
import { resolveAndHideModal } from "@/common/ui/nice-modal-helpers";

export type ChangeOrgSlugConfirmDialogProps = {
  currentSlug: string;
  nextSlug: string;
};

/**
 * Confirms an organization slug change. Resolves `true` when the user
 * accepts the warning; otherwise resolves `false` / hides.
 */
export const ChangeOrgSlugConfirmDialog = NiceModal.create(
  ({ currentSlug, nextSlug }: ChangeOrgSlugConfirmDialogProps) => {
    const modal = useModal();

    return (
      <AlertDialog
        open={modal.visible}
        onOpenChange={(open) => {
          if (!open) {
            resolveAndHideModal(modal, false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change organization URL?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                You are changing the organization URL from{" "}
                <span className="font-mono text-foreground">/{currentSlug}</span>{" "}
                to{" "}
                <span className="font-mono text-foreground">/{nextSlug}</span>.
              </span>
              <span className="block">
                Bookmarks, shared links, invites, and integrations that use the
                old URL will stop working for everyone in this organization.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => resolveAndHideModal(modal, false)}
            >
              Keep current URL
            </AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => resolveAndHideModal(modal, true)}
            >
              Change URL and save
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  },
);
