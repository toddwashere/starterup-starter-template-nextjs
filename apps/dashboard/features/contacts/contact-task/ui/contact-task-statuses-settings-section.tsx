"use client";

import { useState } from "react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { TaskStatusView } from "@workspace/ui/components/entity-label-views";
import { ContactSettingsEntityChip } from "../../common/ui/contact-settings-entity-chip";
import {
  createContactTaskStatusAction,
  deleteContactTaskStatusAction,
  listContactTaskStatusesAction,
} from "../data/contact-task-actions";

type ContactTaskStatus = Extract<
  Awaited<ReturnType<typeof listContactTaskStatusesAction>>,
  { success: true }
>["data"][number];

export function ContactTaskStatusesSettingsSection({
  statuses,
  isPending,
  isMutating,
  onError,
  onReload,
}: {
  statuses: ContactTaskStatus[];
  isPending: boolean;
  isMutating: boolean;
  onError: (message: string) => void;
  onReload: () => Promise<void>;
}) {
  const [newStatusName, setNewStatusName] = useState("");
  const [localMutating, setLocalMutating] = useState(false);
  const mutating = isMutating || localMutating;

  async function handleAddStatus() {
    if (!newStatusName.trim() || mutating) return;
    setLocalMutating(true);
    try {
      const result = await createContactTaskStatusAction({
        name: newStatusName.trim(),
        color: "#6366f1",
        sortOrder: statuses.length,
        isDefault: false,
        isTerminal: false,
      });
      if (!result.success) {
        onError(result.error);
        return;
      }
      setNewStatusName("");
      await onReload();
    } finally {
      setLocalMutating(false);
    }
  }

  async function handleDeleteStatus(statusId: string) {
    if (mutating) return;
    setLocalMutating(true);
    try {
      const result = await deleteContactTaskStatusAction(statusId);
      if (!result.success) {
        onError(result.error);
        return;
      }
      await onReload();
    } finally {
      setLocalMutating(false);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Task Statuses</h2>
      <div className="flex flex-wrap gap-2">
        {statuses.map((status) => (
          <ContactSettingsEntityChip
            key={status.id}
            removable={!status.isDefault}
            removeLabel={`Remove status ${status.name}`}
            onRemove={
              status.isDefault
                ? undefined
                : () => void handleDeleteStatus(status.id)
            }
          >
            <TaskStatusView
              name={status.name}
              color={status.color}
              isTerminal={status.isTerminal}
            />
          </ContactSettingsEntityChip>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="New status name"
          value={newStatusName}
          onChange={(e) => setNewStatusName(e.target.value)}
          className="max-w-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleAddStatus();
          }}
        />
        <Button
          variant="outline"
          onClick={() => void handleAddStatus()}
          disabled={isPending || mutating || !newStatusName.trim()}
        >
          Add Status
        </Button>
      </div>
    </section>
  );
}
