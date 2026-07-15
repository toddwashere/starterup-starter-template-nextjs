"use client";

import { useState } from "react";
import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BULK_ASSIGNABLE_ORG_ROLE_IDS,
  ORG_ROLE_CATALOG,
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
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { bulkMemberRolesAction } from "../data/org-actions";
import type { MemberRoleOutcome } from "@workspace/auth/member-role-management";

export type SelectedMemberSummary = {
  id: string;
  name: string;
};

export type BulkEditMemberRolesButtonModalProps = {
  organizationId: string;
  orgSlug: string;
  operation: "add" | "remove";
  selectedMembers: SelectedMemberSummary[];
};

export type BulkEditMemberRolesResult = {
  failedMemberIds: string[];
};

const OPERATION_COPY: Record<
  "add" | "remove",
  { title: string; description: (count: number) => string; verb: string }
> = {
  add: {
    title: "Add roles",
    description: (count) =>
      `Add the selected roles to ${count} selected ${
        count === 1 ? "member" : "members"
      }.`,
    verb: "Add roles",
  },
  remove: {
    title: "Remove roles",
    description: (count) =>
      `Remove the selected roles from ${count} selected ${
        count === 1 ? "member" : "members"
      }.`,
    verb: "Remove roles",
  },
};

export const BulkEditMemberRolesButtonModal = NiceModal.create(
  ({
    organizationId,
    orgSlug,
    operation,
    selectedMembers,
  }: BulkEditMemberRolesButtonModalProps) => {
    const modal = useModal();
    const queryClient = useQueryClient();
    const [selectedRoles, setSelectedRoles] = useState<OrgRoleId[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [outcomes, setOutcomes] = useState<MemberRoleOutcome[] | null>(null);

    const copy = OPERATION_COPY[operation];
    const memberNameById = new Map(
      selectedMembers.map((member) => [member.id, member.name]),
    );

    function toggleRole(role: OrgRoleId, checked: boolean) {
      setSelectedRoles((previous) =>
        checked ? [...previous, role] : previous.filter((r) => r !== role),
      );
    }

    async function handleClose(failedMemberIds: string[]) {
      modal.resolve({ failedMemberIds });
      modal.hide();
    }

    async function handleSubmit() {
      if (selectedRoles.length === 0 || isSubmitting) return;
      setIsSubmitting(true);
      setActionError(null);
      try {
        const result = await bulkMemberRolesAction({
          organizationId,
          memberIds: selectedMembers.map((member) => member.id),
          operation,
          roles: selectedRoles,
        });
        if (!result.success) {
          setActionError(result.error.message);
          return;
        }

        await queryClient.invalidateQueries({
          queryKey: ["members", orgSlug],
        });
        await queryClient.invalidateQueries({
          queryKey: ["member-management-context", organizationId],
        });

        // Always show the outcomes summary after a successful call (even
        // with zero failures) so the operator can review what happened
        // before the dialog closes; `Done` resolves + hides explicitly.
        setOutcomes(result.data.outcomes);
      } finally {
        setIsSubmitting(false);
      }
    }

    const updatedCount =
      outcomes?.filter((outcome) => outcome.status === "updated").length ?? 0;
    const unchangedCount =
      outcomes?.filter((outcome) => outcome.status === "unchanged").length ??
      0;
    const failedOutcomes =
      outcomes?.filter(
        (
          outcome,
        ): outcome is Extract<MemberRoleOutcome, { status: "failed" }> =>
          outcome.status === "failed",
      ) ?? [];

    return (
      <Dialog
        open={modal.visible}
        onOpenChange={(open) => {
          if (!open) void handleClose(failedOutcomes.map((o) => o.memberId));
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>
              {copy.description(selectedMembers.length)}
            </DialogDescription>
          </DialogHeader>

          {outcomes === null ? (
            <>
              <p className="text-sm text-muted-foreground">
                {selectedMembers.length} selected{" "}
                {selectedMembers.length === 1 ? "member" : "members"}
              </p>
              <div className="space-y-3">
                <Label>Roles</Label>
                {BULK_ASSIGNABLE_ORG_ROLE_IDS.map((role) => {
                  const meta = ORG_ROLE_CATALOG[role];
                  return (
                    <div key={role} className="flex items-start gap-2">
                      <Checkbox
                        id={`bulk-role-${role}`}
                        checked={selectedRoles.includes(role)}
                        onCheckedChange={(checked) =>
                          toggleRole(role, checked === true)
                        }
                      />
                      <div className="grid gap-0.5">
                        <Label
                          htmlFor={`bulk-role-${role}`}
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

              {actionError && (
                <Alert variant="destructive">
                  <AlertDescription>{actionError}</AlertDescription>
                </Alert>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => modal.hide()}>
                  Cancel
                </Button>
                <Button
                  onClick={() => void handleSubmit()}
                  disabled={selectedRoles.length === 0 || isSubmitting}
                >
                  {isSubmitting ? "Working..." : copy.verb}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="space-y-2 text-sm">
                <p>
                  {updatedCount} updated, {unchangedCount} unchanged,{" "}
                  {failedOutcomes.length} failed
                </p>
                {failedOutcomes.length > 0 && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      <p className="mb-1 font-medium">Failed members</p>
                      <ul className="list-inside list-disc space-y-0.5">
                        {failedOutcomes.map((outcome) => (
                          <li key={outcome.memberId}>
                            {memberNameById.get(outcome.memberId) ??
                              outcome.memberId}
                            {": "}
                            {outcome.message}
                          </li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
              </div>
              <DialogFooter>
                <Button
                  onClick={() =>
                    void handleClose(failedOutcomes.map((o) => o.memberId))
                  }
                >
                  Done
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    );
  },
);
