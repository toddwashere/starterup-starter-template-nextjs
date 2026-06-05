"use client";

import Link from "next/link";
import { Button } from "@workspace/ui/components/button";
import { IconForAdd, IconForEdit } from "@workspace/ui/components/icon-for";
import { getPathForOrgFollowUpStep } from "@workspace/routes";
import type { SequenceStepDraft } from "./sequence-steps-editor";
import { createInertEmailPreviewHtml } from "./sequence-step-preview-list-utils";

function formatDelay(minutes: number) {
  if (minutes === 0) return "Immediately";
  if (minutes === 1440) return "After 1 day";
  if (minutes % 1440 === 0) return `After ${minutes / 1440} days`;
  if (minutes % 60 === 0) return `After ${minutes / 60} hours`;
  return `After ${minutes} minutes`;
}

function getPreviewHtml(step: SequenceStepDraft) {
  if (step.composedBodyHtml?.trim()) return step.composedBodyHtml;
  return `
    <div style="font-family: system-ui, sans-serif; color: #111827; padding: 12px;">
      <p>${step.templateProps.bodyIntro}</p>
      <a href="${step.templateProps.ctaUrl}">${step.templateProps.ctaLabel}</a>
    </div>
  `;
}

export function SequenceStepPreviewList({
  orgSlug,
  followUpId,
  steps,
  disabled,
  onAddStep,
}: {
  orgSlug: string;
  followUpId: string;
  steps: SequenceStepDraft[];
  disabled?: boolean;
  onAddStep: () => void;
}) {
  return (
    <div className="space-y-3">
      {steps.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          No steps yet. Add the first email step to this follow-up.
        </div>
      ) : (
        steps.map((step, index) => (
          <div
            key={step.id ?? `step-${index}`}
            className="relative grid gap-4 rounded-lg border bg-card p-4 pr-16 sm:grid-cols-[8rem_minmax(0,1fr)_180px] sm:items-center"
          >
              {step.id && (
                <Button
                  asChild
                  size="icon"
                  variant="outline"
                  className="absolute right-4 top-4 shadow-sm"
                >
                  <Link href={getPathForOrgFollowUpStep(orgSlug, followUpId, step.id)}>
                    <IconForEdit />
                    <span className="sr-only">Edit step</span>
                  </Link>
                </Button>
              )}
            <div className="text-sm font-medium text-muted-foreground">
              {formatDelay(step.delayMinutes)}
            </div>

            <div className="min-w-0">
              <h4 className="truncate font-medium">{step.subjectTemplate}</h4>
            </div>

            <div className="h-28 overflow-hidden rounded-md border bg-background">
              <iframe
                title={`Step ${index + 1} email preview`}
                className="pointer-events-none h-[224px] w-[360px] origin-top-left scale-50 overflow-hidden bg-white"
                sandbox=""
                scrolling="no"
                tabIndex={-1}
                srcDoc={createInertEmailPreviewHtml(getPreviewHtml(step))}
              />
            </div>
          </div>
        ))
      )}

      <Button type="button" variant="outline" disabled={disabled} onClick={onAddStep}>
        <IconForAdd className="mr-2" />
        Add step
      </Button>
    </div>
  );
}
