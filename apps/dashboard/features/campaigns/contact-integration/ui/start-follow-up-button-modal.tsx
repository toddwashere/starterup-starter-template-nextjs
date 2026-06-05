"use client";

import { useEffect, useState } from "react";
import NiceModal, { useModal } from "@ebay/nice-modal-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Button } from "@workspace/ui/components/button";
import { Label } from "@workspace/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { toast } from "@workspace/ui/components/sonner";
import {
  enrollContactsInFollowUpAction,
  listFollowUpSequencesAction,
} from "../../follow-up/data/follow-up-actions";

export const StartFollowUpButtonModal = NiceModal.create(
  ({
    contactIds,
    onSuccess,
  }: {
    contactIds: string[];
    onSuccess?: () => void;
  }) => {
    const modal = useModal();
    const [followUps, setFollowUps] = useState<{ id: string; name: string }[]>([]);
    const [followUpId, setFollowUpId] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      void (async () => {
        const result = await listFollowUpSequencesAction();
        if (result.success) {
          setFollowUps(result.data.map((item) => ({ id: item.id, name: item.name })));
        }
      })();
    }, []);

    async function handleStart() {
      if (!followUpId || isSubmitting) return;
      setIsSubmitting(true);
      setError(null);
      try {
        const result = await enrollContactsInFollowUpAction(followUpId, contactIds);
        if (!result.success) {
          setError(result.error);
          toast.error(result.error);
          return;
        }
        const followUpName = followUps.find((item) => item.id === followUpId)?.name ?? "follow-up";
        toast.success(
          `Enrolled ${result.data.enrolledCount} ${
            result.data.enrolledCount === 1 ? "contact" : "contacts"
          } in ${followUpName}`,
        );
        onSuccess?.();
        modal.hide();
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
            <DialogTitle>Start follow-up</DialogTitle>
            <DialogDescription>
              Enroll {contactIds.length} selected{" "}
              {contactIds.length === 1 ? "contact" : "contacts"} in a follow-up sequence.
            </DialogDescription>
          </DialogHeader>

          {followUps.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No follow-ups yet. Create one under Campaigns → Follow-ups first.
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="follow-up-select">Follow-up</Label>
              <Select value={followUpId} onValueChange={setFollowUpId}>
                <SelectTrigger id="follow-up-select">
                  <SelectValue placeholder="Choose follow-up" />
                </SelectTrigger>
                <SelectContent>
                  {followUps.map((followUp) => (
                    <SelectItem key={followUp.id} value={followUp.id}>
                      {followUp.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              onClick={() => void handleStart()}
              disabled={!followUpId || isSubmitting || followUps.length === 0}
            >
              {isSubmitting ? "Enrolling…" : "Start follow-up"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
);
