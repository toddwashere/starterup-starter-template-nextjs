"use client";

import type { ProviderModelValue } from "@workspace/ai/ai-models-available";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import {
  groupProviderModelOptions,
  type ProviderModelSelectOption,
} from "./ai-provider-model-select-utils";

interface AiProviderModelSelectProps {
  value: ProviderModelValue;
  onValueChange: (value: ProviderModelValue) => void;
  /** Available options (already filtered to configured providers) from the server. */
  options: ProviderModelSelectOption[];
  disabled?: boolean;
  triggerClassName?: string;
}

/**
 * Grouped model picker for the AI Assistant. Purely presentational: options are
 * passed in from `listAvailableAiModelsAction` — this component never imports
 * `keys()` or the availability filter, so no server-only code reaches the client.
 */
export function AiProviderModelSelect({
  value,
  onValueChange,
  options,
  disabled,
  triggerClassName,
}: AiProviderModelSelectProps) {
  const groups = groupProviderModelOptions(options);
  const selected = options.find((o) => o.value === value);

  return (
    <Select
      value={value}
      onValueChange={(v) => onValueChange(v as ProviderModelValue)}
      disabled={disabled}
    >
      <SelectTrigger className={triggerClassName} size="sm">
        <SelectValue placeholder="Select a model">
          {selected ? `${selected.groupLabel} · ${selected.label}` : null}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {groups.map((group) => (
          <SelectGroup key={group.groupLabel}>
            <SelectLabel>{group.groupLabel}</SelectLabel>
            {group.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
