"use client";

import type { ReactNode } from "react";
import { Button } from "@workspace/ui/components/button";
import { IconForRemove } from "@workspace/ui/components/icon-for";

export function ContactSettingsEntityChip({
  children,
  onRemove,
  removable = true,
  removeLabel,
}: {
  children: ReactNode;
  onRemove?: () => void;
  removable?: boolean;
  removeLabel?: string;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {children}
      {removable && onRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 text-muted-foreground"
          aria-label={removeLabel ?? "Remove"}
          onClick={onRemove}
        >
          <IconForRemove className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}
