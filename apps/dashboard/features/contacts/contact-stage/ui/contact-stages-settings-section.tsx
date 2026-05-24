"use client";

import { useState } from "react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { StageView } from "@workspace/ui/components/entity-label-views";
import { ContactSettingsEntityChip } from "../../common/ui/contact-settings-entity-chip";
import {
  createContactStageAction,
  deleteContactStageAction,
  type listContactStagesAction,
} from "../data/contact-stage-actions";

type ContactStage = Extract<
  Awaited<ReturnType<typeof listContactStagesAction>>,
  { success: true }
>["data"][number];

export function ContactStagesSettingsSection({
  stages,
  isPending,
  isMutating,
  onError,
  onReload,
}: {
  stages: ContactStage[];
  isPending: boolean;
  isMutating: boolean;
  onError: (message: string) => void;
  onReload: () => Promise<void>;
}) {
  const [newStageName, setNewStageName] = useState("");
  const [localMutating, setLocalMutating] = useState(false);
  const mutating = isMutating || localMutating;

  async function handleAddStage() {
    if (!newStageName.trim() || mutating) return;
    setLocalMutating(true);
    try {
      const result = await createContactStageAction({
        name: newStageName.trim(),
        color: "#6366f1",
        sortOrder: stages.length,
        isDefault: false,
      });
      if (!result.success) {
        onError(result.error);
        return;
      }
      setNewStageName("");
      await onReload();
    } finally {
      setLocalMutating(false);
    }
  }

  async function handleDeleteStage(stageId: string) {
    if (mutating) return;
    setLocalMutating(true);
    try {
      const result = await deleteContactStageAction(stageId);
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
      <h2 className="text-lg font-semibold">Contact Stages</h2>
      <div className="flex flex-wrap gap-2">
        {stages.map((stage) => (
          <ContactSettingsEntityChip
            key={stage.id}
            removable={!stage.isDefault}
            removeLabel={`Remove stage ${stage.name}`}
            onRemove={
              stage.isDefault
                ? undefined
                : () => void handleDeleteStage(stage.id)
            }
          >
            <StageView name={stage.name} color={stage.color} />
          </ContactSettingsEntityChip>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="New stage name"
          value={newStageName}
          onChange={(e) => setNewStageName(e.target.value)}
          className="max-w-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleAddStage();
          }}
        />
        <Button
          variant="outline"
          onClick={() => void handleAddStage()}
          disabled={isPending || mutating || !newStageName.trim()}
        >
          Add Stage
        </Button>
      </div>
    </section>
  );
}
