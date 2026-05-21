"use client";

import { StageView } from "@workspace/ui/components/entity-label-views";
import { Label } from "@workspace/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";

type ContactStage = {
  id: string;
  name: string;
  color?: string | null;
};

export function ContactStageField({
  id,
  label = "Stage",
  value,
  stages,
  isLoading = false,
  onChange,
}: {
  id: string;
  label?: string;
  value: string;
  stages: ContactStage[];
  isLoading?: boolean;
  onChange: (stageId: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value || "__none__"}
        onValueChange={(next) => onChange(next === "__none__" ? "" : next)}
        disabled={isLoading}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={isLoading ? "Loading stages…" : "No stage"} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">No stage</SelectItem>
          {stages.map((stage) => (
            <SelectItem key={stage.id} value={stage.id}>
              <StageView name={stage.name} color={stage.color} size="sm" />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
