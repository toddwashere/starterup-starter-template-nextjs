"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import NiceModal from "@ebay/nice-modal-react";
import { formatDate } from "@workspace/common";
import { Button } from "@workspace/ui/components/button";
import { Page, PageBody } from "@workspace/ui/components/page";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { toast } from "@workspace/ui/components/sonner";
import { PageHeaderInOrg } from "@/common/ui/page-header-in-org";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb";
import type { ActionResult } from "@/common/data/action-result";
import {
  SequenceStepsEditor,
  draftToStepInput,
  mapSequenceStepToDraft,
  type SequenceStepDraft,
} from "./sequence-steps-editor";
import { DeleteSequenceStepConfirmDialog } from "./delete-sequence-step-confirm-dialog";

type SequenceStepRecord = Parameters<typeof mapSequenceStepToDraft>[0] & {
  sequenceId: string;
  updatedAt: Date | string;
  sequence: { name: string };
};

type StepInput = ReturnType<typeof draftToStepInput>;

export function SequenceStepEditPageContent({
  listLabel,
  listHref,
  sequenceHref,
  sequenceId,
  stepId,
  notFoundMessage,
  loadStepAction,
  updateStepAction,
  deleteStepAction,
}: {
  listLabel: string;
  listHref: string;
  sequenceHref: string;
  sequenceId: string;
  stepId: string;
  notFoundMessage: string;
  loadStepAction: (sequenceId: string, stepId: string) => Promise<ActionResult<SequenceStepRecord>>;
  updateStepAction: (
    sequenceId: string,
    stepId: string,
    data: StepInput,
  ) => Promise<ActionResult<{ id: string }>>;
  deleteStepAction?: (sequenceId: string, stepId: string) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [stepRecord, setStepRecord] = useState<SequenceStepRecord | null>(null);
  const [step, setStep] = useState<SequenceStepDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadStepAction(sequenceId, stepId);
      if (!result.success) {
        toast.error(result.error);
        setStepRecord(null);
        setStep(null);
        return;
      }
      setStepRecord(result.data);
      setStep(mapSequenceStepToDraft(result.data));
    } finally {
      setLoading(false);
    }
  }, [loadStepAction, sequenceId, stepId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    if (!step || saving) return;
    setSaving(true);
    try {
      const result = await updateStepAction(sequenceId, stepId, draftToStepInput(step));
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Step saved");
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteStepAction || saving) return;
    const confirmed = await NiceModal.show(DeleteSequenceStepConfirmDialog);
    if (!confirmed) return;

    setSaving(true);
    try {
      const result = await deleteStepAction(sequenceId, stepId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Step deleted");
      router.push(sequenceHref);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Page className="flex min-h-0 flex-1 flex-col">
        <PageHeaderInOrg title="Edit step" />
        <PageBody className="space-y-4 p-6">
          <Skeleton className="h-10 w-full max-w-md" />
          <Skeleton className="h-96 w-full" />
        </PageBody>
      </Page>
    );
  }

  if (!stepRecord || !step) {
    return (
      <Page className="flex min-h-0 flex-1 flex-col">
        <PageHeaderInOrg title="Step not found" />
        <PageBody className="p-6">
          <p className="text-muted-foreground">{notFoundMessage}</p>
        </PageBody>
      </Page>
    );
  }

  return (
    <Page className="flex min-h-0 flex-1 flex-col">
      <PageHeaderInOrg
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href={listHref}>{listLabel}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href={sequenceHref}>{stepRecord.sequence.name}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Step {step.sortOrder + 1}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {deleteStepAction && (
              <Button
                variant="destructive"
                onClick={() => void handleDelete()}
                disabled={saving}
              >
                Delete
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href={sequenceHref}>Back</Link>
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? "Saving…" : "Save step"}
            </Button>
          </div>
        }
      />

      <PageBody className="space-y-6 p-6">
        <div>
          <h2 className="text-lg font-semibold">Edit step {step.sortOrder + 1}</h2>
          <p className="text-sm text-muted-foreground">
            Changes save independently from the sequence overview. Last updated{" "}
            {formatDate(stepRecord.updatedAt)}.
          </p>
        </div>

        <SequenceStepsEditor
          steps={[step]}
          onChange={(nextSteps) => setStep(nextSteps[0] ?? step)}
          disabled={saving}
          allowAdd={false}
          allowRemove={false}
        />
      </PageBody>
    </Page>
  );
}
