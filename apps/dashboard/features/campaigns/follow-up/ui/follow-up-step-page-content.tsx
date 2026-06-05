"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDate } from "@workspace/common";
import { getPathForOrgFollowUp, getPathForOrgFollowUps } from "@workspace/routes";
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
import {
  getFollowUpStepAction,
  updateFollowUpStepAction,
} from "../data/follow-up-actions";
import {
  SequenceStepsEditor,
  draftToStepInput,
  mapSequenceStepToDraft,
  type SequenceStepDraft,
} from "../../common/ui/sequence-steps-editor";

type FollowUpStep = Extract<
  Awaited<ReturnType<typeof getFollowUpStepAction>>,
  { success: true }
>["data"];

export function FollowUpStepPageContent({
  orgSlug,
  followUpId,
  stepId,
}: {
  orgSlug: string;
  followUpId: string;
  stepId: string;
}) {
  const [stepRecord, setStepRecord] = useState<FollowUpStep | null>(null);
  const [step, setStep] = useState<SequenceStepDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getFollowUpStepAction(followUpId, stepId);
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
  }, [followUpId, stepId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    if (!step || saving) return;
    setSaving(true);
    try {
      const result = await updateFollowUpStepAction(followUpId, stepId, draftToStepInput(step));
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
          <p className="text-muted-foreground">This follow-up step may have been removed.</p>
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
                  <Link href={getPathForOrgFollowUps(orgSlug)}>Follow-ups</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href={getPathForOrgFollowUp(orgSlug, followUpId)}>
                    {stepRecord.sequence.name}
                  </Link>
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
            <Button asChild variant="outline">
              <Link href={getPathForOrgFollowUp(orgSlug, followUpId)}>Back</Link>
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
            Changes save independently from the follow-up overview. Last updated{" "}
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
