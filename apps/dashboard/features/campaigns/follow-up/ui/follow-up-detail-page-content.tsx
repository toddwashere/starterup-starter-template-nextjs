"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDate } from "@workspace/common";
import { getPathForOrgFollowUps } from "@workspace/routes";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
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
  getFollowUpSequenceAction,
  saveFollowUpSequenceStepsAction,
  updateFollowUpSequenceAction,
} from "../data/follow-up-actions";
import {
  SequenceStepsEditor,
  createDefaultSteps,
  draftToStepInput,
  mapSequenceStepToDraft,
  type SequenceStepDraft,
} from "../../common/ui/sequence-steps-editor";
import { SequenceStatsPanel, SequenceStatusBadge } from "../../common/ui/sequence-stats-panel";

type FollowUpDetail = Extract<
  Awaited<ReturnType<typeof getFollowUpSequenceAction>>,
  { success: true }
>["data"];

function mapStepsToDraft(steps: FollowUpDetail["sequence"]["steps"]): SequenceStepDraft[] {
  if (steps.length === 0) return createDefaultSteps();
  return steps.map(mapSequenceStepToDraft);
}

export function FollowUpDetailPageContent({
  orgSlug,
  followUpId,
}: {
  orgSlug: string;
  followUpId: string;
}) {
  const [detail, setDetail] = useState<FollowUpDetail | null>(null);
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<SequenceStepDraft[]>(createDefaultSteps());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getFollowUpSequenceAction(followUpId);
      if (!result.success) {
        toast.error(result.error);
        setDetail(null);
        return;
      }
      setDetail(result.data);
      setName(result.data.sequence.name);
      setSteps(mapStepsToDraft(result.data.sequence.steps));
    } finally {
      setLoading(false);
    }
  }, [followUpId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      const nameResult = await updateFollowUpSequenceAction(followUpId, { name: name.trim() });
      if (!nameResult.success) {
        toast.error(nameResult.error);
        return;
      }
      const stepsResult = await saveFollowUpSequenceStepsAction(
        followUpId,
        steps.map((step) => ({ ...draftToStepInput(step), id: step.id })),
      );
      if (!stepsResult.success) {
        toast.error(stepsResult.error);
        return;
      }
      toast.success("Follow-up saved");
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Page className="flex min-h-0 flex-1 flex-col">
        <PageHeaderInOrg title="Follow-up" />
        <PageBody className="space-y-4 p-6">
          <Skeleton className="h-10 w-full max-w-md" />
          <Skeleton className="h-48 w-full" />
        </PageBody>
      </Page>
    );
  }

  if (!detail) {
    return (
      <Page className="flex min-h-0 flex-1 flex-col">
        <PageHeaderInOrg title="Follow-up not found" />
        <PageBody className="p-6">
          <p className="text-muted-foreground">This follow-up may have been removed.</p>
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
                <BreadcrumbPage>{detail.sequence.name}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        actions={
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        }
      />

      <PageBody className="space-y-6 p-6">
        <SequenceStatusBadge status={detail.sequence.status} />

        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="follow-up-name">Follow-up name</Label>
              <Input
                id="follow-up-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-3">
              <h3 className="font-semibold">Steps</h3>
              <SequenceStepsEditor steps={steps} onChange={setSteps} disabled={saving} />
            </div>
          </div>

          <SequenceStatsPanel
            enrollmentCounts={detail.stats.enrollmentCounts}
            perStep={detail.stats.perStep}
          />
        </div>

        <p className="text-sm text-muted-foreground">
          Enroll contacts from the contact list or contact detail page. Last updated{" "}
          {formatDate(detail.sequence.updatedAt)}.
        </p>
      </PageBody>
    </Page>
  );
}
