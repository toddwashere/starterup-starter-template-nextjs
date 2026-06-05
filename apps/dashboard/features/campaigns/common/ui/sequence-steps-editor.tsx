"use client";

import { useEffect, useState } from "react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { IconForAdd, IconForDelete } from "@workspace/ui/components/icon-for";
import { listMarketingTemplatesAction } from "../../campaign/data/campaign-actions";

export type SequenceStepDraft = {
  id?: string;
  sortOrder: number;
  delayMinutes: number;
  templateKey: string;
  subjectTemplate: string;
  templateProps: {
    bodyIntro: string;
    ctaUrl: string;
    ctaLabel: string;
  };
};

const DEFAULT_STEP: SequenceStepDraft = {
  sortOrder: 0,
  delayMinutes: 0,
  templateKey: "nurture-intro",
  subjectTemplate: "Hello {{firstName}}",
  templateProps: {
    bodyIntro: "We wanted to reach out.",
    ctaUrl: "https://example.com",
    ctaLabel: "Learn more",
  },
};

export function SequenceStepsEditor({
  steps,
  onChange,
  disabled,
}: {
  steps: SequenceStepDraft[];
  onChange: (steps: SequenceStepDraft[]) => void;
  disabled?: boolean;
}) {
  const [templates, setTemplates] = useState<
    Array<{ key: string; label: string; description: string }>
  >([]);

  useEffect(() => {
    void (async () => {
      const result = await listMarketingTemplatesAction();
      if (result.success) setTemplates(result.data);
    })();
  }, []);

  function updateStep(index: number, patch: Partial<SequenceStepDraft>) {
    onChange(steps.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  }

  function updateStepProps(
    index: number,
    patch: Partial<SequenceStepDraft["templateProps"]>,
  ) {
    onChange(
      steps.map((step, i) =>
        i === index
          ? { ...step, templateProps: { ...step.templateProps, ...patch } }
          : step,
      ),
    );
  }

  function addStep() {
    onChange([
      ...steps,
      {
        ...DEFAULT_STEP,
        sortOrder: steps.length,
        delayMinutes: steps.length === 0 ? 0 : 1440,
      },
    ]);
  }

  function removeStep(index: number) {
    onChange(
      steps
        .filter((_, i) => i !== index)
        .map((step, i) => ({ ...step, sortOrder: i })),
    );
  }

  return (
    <div className="space-y-4">
      {steps.length === 0 && (
        <p className="text-sm text-muted-foreground">No steps yet. Add the first email step.</p>
      )}

      {steps.map((step, index) => (
        <div key={step.id ?? `new-${index}`} className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-medium">Step {index + 1}</h4>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => removeStep(index)}
            >
              <IconForDelete />
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Template</Label>
              <Select
                value={step.templateKey}
                onValueChange={(value) => updateStep(index, { templateKey: value })}
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((template) => (
                    <SelectItem key={template.key} value={template.key}>
                      {template.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Delay (minutes after previous step)</Label>
              <Input
                type="number"
                min={0}
                value={step.delayMinutes}
                disabled={disabled}
                onChange={(e) =>
                  updateStep(index, { delayMinutes: Number(e.target.value) || 0 })
                }
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Subject</Label>
            <Input
              value={step.subjectTemplate}
              disabled={disabled}
              onChange={(e) => updateStep(index, { subjectTemplate: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Intro body</Label>
            <Input
              value={step.templateProps.bodyIntro}
              disabled={disabled}
              onChange={(e) => updateStepProps(index, { bodyIntro: e.target.value })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>CTA label</Label>
              <Input
                value={step.templateProps.ctaLabel}
                disabled={disabled}
                onChange={(e) => updateStepProps(index, { ctaLabel: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>CTA URL</Label>
              <Input
                value={step.templateProps.ctaUrl}
                disabled={disabled}
                onChange={(e) => updateStepProps(index, { ctaUrl: e.target.value })}
              />
            </div>
          </div>
        </div>
      ))}

      <Button type="button" variant="outline" disabled={disabled} onClick={addStep}>
        <IconForAdd className="mr-2" />
        Add step
      </Button>
    </div>
  );
}

export function createDefaultSteps(): SequenceStepDraft[] {
  return [{ ...DEFAULT_STEP }];
}
