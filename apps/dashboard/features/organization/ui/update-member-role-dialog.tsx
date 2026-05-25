"use client";

import { useEffect, useState } from "react";
import { authClient } from "@workspace/auth/client";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Label } from "@workspace/ui/components/label";
import { useQueryClient } from "@tanstack/react-query";

const ROLE_OPTIONS: { id: "owner" | "admin" | "member"; label: string }[] = [
  { id: "owner", label: "Owner" },
  { id: "admin", label: "Admin" },
  { id: "member", label: "Member" },
];

interface UpdateMemberRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  memberName: string;
  currentRoles: string[];
  ownerExistsElsewhere: boolean;
  organizationId: string;
  orgSlug: string;
}

function sameRoleSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((role, i) => role === sortedB[i]);
}

export function UpdateMemberRoleDialog({
  open,
  onOpenChange,
  memberId,
  memberName,
  currentRoles,
  ownerExistsElsewhere,
  organizationId,
  orgSlug,
}: UpdateMemberRoleDialogProps) {
  const [roles, setRoles] = useState<string[]>(currentRoles);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (open) {
      setRoles(currentRoles);
      setError(null);
    }
  }, [open, currentRoles]);

  const toggleRole = (roleId: string, checked: boolean) => {
    setRoles((prev) =>
      checked ? [...prev, roleId] : prev.filter((r) => r !== roleId),
    );
  };

  const onSubmit = async () => {
    if (sameRoleSet(roles, currentRoles)) {
      onOpenChange(false);
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await authClient.organization.updateMemberRole({
        memberId,
        role: roles as ("owner" | "admin" | "member")[],
        organizationId,
      });
      await queryClient.invalidateQueries({
        queryKey: ["members", orgSlug],
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update role");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change Role</DialogTitle>
          <DialogDescription>
            Update the roles for {memberName}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-3">
            <Label>Roles</Label>
            {ROLE_OPTIONS.map((option) => {
              const ownerDisabled =
                option.id === "owner" &&
                ownerExistsElsewhere &&
                !currentRoles.includes("owner");
              return (
                <div key={option.id} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`role-${option.id}`}
                      checked={roles.includes(option.id)}
                      disabled={ownerDisabled}
                      onCheckedChange={(checked) =>
                        toggleRole(option.id, checked === true)
                      }
                    />
                    <Label
                      htmlFor={`role-${option.id}`}
                      className="font-normal"
                    >
                      {option.label}
                    </Label>
                  </div>
                  {ownerDisabled && (
                    <p className="text-xs text-muted-foreground">
                      Another member is already the owner.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={isSubmitting || roles.length === 0}
          >
            {isSubmitting ? "Updating..." : "Update Role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
