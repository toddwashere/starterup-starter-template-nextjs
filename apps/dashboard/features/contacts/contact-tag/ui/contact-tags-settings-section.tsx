"use client";

import { useState } from "react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { TagView } from "@workspace/ui/components/entity-label-views";
import { ContactSettingsEntityChip } from "../../common/ui/contact-settings-entity-chip";
import {
  createContactTagAction,
  deleteContactTagAction,
  type listContactTagsAction,
} from "../data/contact-tag-actions";

type ContactTag = Extract<
  Awaited<ReturnType<typeof listContactTagsAction>>,
  { success: true }
>["data"][number];

export function ContactTagsSettingsSection({
  tags,
  isPending,
  isMutating,
  onError,
  onReload,
}: {
  tags: ContactTag[];
  isPending: boolean;
  isMutating: boolean;
  onError: (message: string) => void;
  onReload: () => Promise<void>;
}) {
  const [newTagName, setNewTagName] = useState("");
  const [localMutating, setLocalMutating] = useState(false);
  const mutating = isMutating || localMutating;

  async function handleAddTag() {
    if (!newTagName.trim() || mutating) return;
    setLocalMutating(true);
    try {
      const result = await createContactTagAction({ name: newTagName.trim(), color: "#6366f1" });
      if (!result.success) {
        onError(result.error);
        return;
      }
      setNewTagName("");
      await onReload();
    } finally {
      setLocalMutating(false);
    }
  }

  async function handleDeleteTag(tagId: string) {
    if (mutating) return;
    setLocalMutating(true);
    try {
      const result = await deleteContactTagAction(tagId);
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
      <h2 className="text-lg font-semibold">Tags</h2>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <ContactSettingsEntityChip
            key={tag.id}
            removeLabel={`Remove tag ${tag.name}`}
            onRemove={() => void handleDeleteTag(tag.id)}
          >
            <TagView name={tag.name} color={tag.color} />
          </ContactSettingsEntityChip>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="New tag name"
          value={newTagName}
          onChange={(e) => setNewTagName(e.target.value)}
          className="max-w-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleAddTag();
          }}
        />
        <Button
          variant="outline"
          onClick={() => void handleAddTag()}
          disabled={isPending || mutating || !newTagName.trim()}
        >
          Add Tag
        </Button>
      </div>
    </section>
  );
}
