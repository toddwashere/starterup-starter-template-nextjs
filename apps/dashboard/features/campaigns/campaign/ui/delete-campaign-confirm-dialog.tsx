"use client";

import NiceModal, { useModal } from "@ebay/nice-modal-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Button } from "@workspace/ui/components/button";

export const DeleteCampaignConfirmDialog = NiceModal.create(
  ({ campaignName }: { campaignName: string }) => {
    const modal = useModal();

    function handleConfirm() {
      modal.resolve(true);
      modal.hide();
    }

    return (
      <AlertDialog open={modal.visible} onOpenChange={(open) => !open && modal.hide()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {campaignName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the campaign, its steps, runs, enrollments, and related
              reporting data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={modal.hide}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirm}>
              Delete campaign
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  },
);
