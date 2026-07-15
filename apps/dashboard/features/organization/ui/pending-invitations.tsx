"use client";

import { useState } from "react";
import { authClient } from "@workspace/auth/client";
import { formatDate } from "@workspace/common";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Badge } from "@workspace/ui/components/badge";
import { useQueryClient } from "@tanstack/react-query";

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: Date;
}

interface PendingInvitationsProps {
  invitations: Invitation[];
  orgSlug: string;
  canManageInvitations: boolean;
}

export function PendingInvitations({
  invitations,
  orgSlug,
  canManageInvitations,
}: PendingInvitationsProps) {
  const queryClient = useQueryClient();
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const pendingInvitations = invitations.filter(
    (inv) => inv.status === "pending"
  );

  if (pendingInvitations.length === 0) {
    return null;
  }

  const handleCancel = async (invitationId: string) => {
    setCancellingId(invitationId);
    try {
      await authClient.organization.cancelInvitation({ invitationId });
      await queryClient.invalidateQueries({
        queryKey: ["organization", orgSlug],
      });
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pending Invitations</CardTitle>
        <CardDescription>
          {pendingInvitations.length} pending{" "}
          {pendingInvitations.length === 1 ? "invitation" : "invitations"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {pendingInvitations.map((invitation) => (
            <div
              key={invitation.id}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">{invitation.email}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs capitalize">
                    {invitation.role}
                  </Badge>
                  <Badge variant="outline" className="text-xs capitalize">
                    {invitation.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Expires {formatDate(invitation.expiresAt)}
                  </span>
                </div>
              </div>
              {canManageInvitations && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCancel(invitation.id)}
                  disabled={cancellingId === invitation.id}
                >
                  {cancellingId === invitation.id ? "Cancelling..." : "Cancel"}
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
