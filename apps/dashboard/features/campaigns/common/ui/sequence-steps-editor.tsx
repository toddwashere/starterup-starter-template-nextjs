"use client";

import { useEffect, useState } from "react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Textarea } from "@workspace/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { IconForAdd, IconForDelete } from "@workspace/ui/components/icon-for";
import { type StepContentSource } from "@workspace/campaigns/schemas/sequence-schemas";
import { listMarketingTemplatesAction } from "../../campaign/data/campaign-actions";
import { CampaignEmailEditor } from "./campaign-email-editor";
import {
  delayDaysToMinutes,
  delayMinutesToDays,
  getDelayDayOptions,
} from "./sequence-delay-utils";

export type SequenceStepDraft = {
  id?: string;
  sortOrder: number;
  delayMinutes: number;
  contentSource: StepContentSource;
  templateKey: string;
  subjectTemplate: string;
  templateProps: {
    bodyIntro: string;
    ctaUrl: string;
    ctaLabel: string;
  };
  editorDocument?: unknown;
  composedBodyHtml?: string;
  composedBodyText?: string;
};

const DEFAULT_REGISTRY_PROPS = {
  bodyIntro: "We wanted to reach out.",
  ctaUrl: "https://example.com",
  ctaLabel: "Learn more",
};

const DEFAULT_STEP: SequenceStepDraft = {
  sortOrder: 0,
  delayMinutes: 0,
  contentSource: "editor",
  templateKey: "nurture-intro",
  subjectTemplate: "Hello {{firstName}}",
  templateProps: DEFAULT_REGISTRY_PROPS,
};

export function SequenceStepsEditor({
  steps,
  onChange,
  disabled,
  allowAdd = true,
  allowRemove = true,
}: {
  steps: SequenceStepDraft[];
  onChange: (steps: SequenceStepDraft[]) => void;
  disabled?: boolean;
  allowAdd?: boolean;
  allowRemove?: boolean;
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

  function updateDelayDays(index: number, days: number) {
    updateStep(index, {
      delayMinutes: delayDaysToMinutes(days),
    });
  }

  function addStep() {
    onChange([
      ...steps,
      {
        ...DEFAULT_STEP,
        sortOrder: steps.length,
        delayMinutes: steps.length === 0 ? 0 : delayDaysToMinutes(1),
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
            {allowRemove && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => removeStep(index)}
              >
                <IconForDelete />
              </Button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Content type</Label>
              <Select
                value={step.contentSource}
                onValueChange={(value: StepContentSource) =>
                  updateStep(index, { contentSource: value })
                }
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">Visual editor</SelectItem>
                  <SelectItem value="registry">Built-in template</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Delay after previous step (days)</Label>
              <Select
                value={String(delayMinutesToDays(step.delayMinutes))}
                onValueChange={(value) => updateDelayDays(index, Number(value))}
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {getDelayDayOptions(delayMinutesToDays(step.delayMinutes)).map((days) => (
                    <SelectItem key={days} value={String(days)}>
                      {days === 1 ? "1 day" : `${days} days`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Subject</Label>
            <Input
              value={step.subjectTemplate}
              disabled={disabled}
              onChange={(e) => updateStep(index, { subjectTemplate: e.target.value })}
              placeholder="Hello {{firstName}}"
            />
          </div>

          {step.contentSource === "editor" ? (
            <CampaignEmailEditor
              content={step.editorDocument ?? step.composedBodyHtml}
              snapshot={
                step.composedBodyHtml
                  ? {
                      composedBodyHtml: step.composedBodyHtml,
                      composedBodyText: step.composedBodyText ?? "",
                    }
                  : undefined
              }
              disabled={disabled}
              onChange={(value) =>
                updateStep(index, {
                  editorDocument: value.editorDocument,
                  composedBodyHtml: value.composedBodyHtml,
                  composedBodyText: value.composedBodyText,
                })
              }
            />
          ) : (
            <>
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
                <Label>Intro body</Label>
                <Textarea
                  value={step.templateProps.bodyIntro}
                  disabled={disabled}
                  rows={3}
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
            </>
          )}
        </div>
      ))}

      {allowAdd && (
        <Button type="button" variant="outline" disabled={disabled} onClick={addStep}>
          <IconForAdd className="mr-2" />
          Add step
        </Button>
      )}
    </div>
  );
}

export function createDefaultSteps(): SequenceStepDraft[] {
  return [{ ...DEFAULT_STEP }];
}

export function mapSequenceStepToDraft(step: {
  id: string;
  sortOrder: number;
  delayMinutes: number;
  contentSource?: string;
  templateKey: string;
  subjectTemplate: string;
  templateProps: unknown;
  editorDocument?: unknown;
  composedBodyHtml?: string | null;
  composedBodyText?: string | null;
}): SequenceStepDraft {
  const props = (step.templateProps as SequenceStepDraft["templateProps"] | null) ?? DEFAULT_REGISTRY_PROPS;
  return {
    id: step.id,
    sortOrder: step.sortOrder,
    delayMinutes: step.delayMinutes,
    contentSource: step.contentSource === "registry" ? "registry" : "editor",
    templateKey: step.templateKey,
    subjectTemplate: step.subjectTemplate,
    templateProps: {
      bodyIntro: props.bodyIntro ?? DEFAULT_REGISTRY_PROPS.bodyIntro,
      ctaUrl: props.ctaUrl ?? DEFAULT_REGISTRY_PROPS.ctaUrl,
      ctaLabel: props.ctaLabel ?? DEFAULT_REGISTRY_PROPS.ctaLabel,
    },
    editorDocument: step.editorDocument ?? undefined,
    composedBodyHtml: step.composedBodyHtml ?? undefined,
    composedBodyText: step.composedBodyText ?? undefined,
  };
}

export function draftToStepInput(step: SequenceStepDraft) {
  return {
    sortOrder: step.sortOrder,
    delayMinutes: step.delayMinutes,
    contentSource: step.contentSource,
    templateKey: step.templateKey,
    subjectTemplate: step.subjectTemplate,
    templateProps: step.contentSource === "registry" ? step.templateProps : undefined,
    editorDocument: step.contentSource === "editor" ? step.editorDocument : undefined,
    composedBodyHtml: step.contentSource === "editor" ? step.composedBodyHtml : undefined,
    composedBodyText: step.contentSource === "editor" ? step.composedBodyText : undefined,
  };
}
