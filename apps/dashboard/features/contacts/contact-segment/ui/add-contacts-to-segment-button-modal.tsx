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
  addContactsToSegmentAction,
  listContactSegmentsAction,
} from "../data/contact-segment-actions";

export const AddContactsToSegmentButtonModal = NiceModal.create(
  ({
    contactIds,
    onSuccess,
  }: {
    contactIds: string[];
    onSuccess?: () => void;
  }) => {
    const modal = useModal();
    const [segments, setSegments] = useState<{ id: string; name: string }[]>([]);
    const [segmentId, setSegmentId] = useState<string>("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      void (async () => {
        const result = await listContactSegmentsAction();
        if (result.success) setSegments(result.data);
      })();
    }, []);

    async function handleAdd() {
      if (!segmentId || isSubmitting) return;
      setIsSubmitting(true);
      setError(null);
      try {
        const result = await addContactsToSegmentAction(segmentId, contactIds);
        if (!result.success) {
          setError(result.error);
          toast.error(result.error);
          return;
        }
        const segmentName = segments.find((s) => s.id === segmentId)?.name ?? "segment";
        toast.success(
          `Added ${result.data.addedCount} ${
            result.data.addedCount === 1 ? "contact" : "contacts"
          } to ${segmentName}`,
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
            <DialogTitle>Add to segment</DialogTitle>
            <DialogDescription>
              Add {contactIds.length} selected{" "}
              {contactIds.length === 1 ? "contact" : "contacts"} to a segment.
            </DialogDescription>
          </DialogHeader>

          {segments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No segments yet. Use &ldquo;Save segment&rdquo; in the contacts toolbar to create
              one first.
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="segment-select">Segment</Label>
              <Select value={segmentId} onValueChange={setSegmentId}>
                <SelectTrigger id="segment-select">
                  <SelectValue placeholder="Choose a segment" />
                </SelectTrigger>
                <SelectContent>
                  {segments.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
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
              onClick={() => void handleAdd()}
              disabled={!segmentId || isSubmitting || segments.length === 0}
            >
              {isSubmitting ? "Adding…" : "Add to segment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
);
