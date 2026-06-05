"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import NiceModal from "@ebay/nice-modal-react";
import { formatDate } from "@workspace/common";
import {
  getPathForOrgCampaignStep,
  getPathForOrgCampaigns,
} from "@workspace/routes";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Page, PageBody } from "@workspace/ui/components/page";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
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
import { listContactSegmentsAction } from "@/features/contacts/contact-segment/data/contact-segment-actions";
import {
  createCampaignStepAction,
  deleteCampaignSequenceAction,
  getCampaignSequenceAction,
  pauseCampaignSequenceAction,
  sendCampaignTestEmailAction,
  startCampaignRunAction,
  updateCampaignSequenceAction,
} from "../data/campaign-actions";
import {
  mapSequenceStepToDraft,
  type SequenceStepDraft,
} from "../../common/ui/sequence-steps-editor";
import { SequenceStepPreviewList } from "../../common/ui/sequence-step-preview-list";
import {
  CampaignRunStatusBadge,
  SequenceStatsPanel,
  SequenceStatusBadge,
} from "../../common/ui/sequence-stats-panel";
import { DeleteCampaignConfirmDialog } from "./delete-campaign-confirm-dialog";

type CampaignDetail = Extract<
  Awaited<ReturnType<typeof getCampaignSequenceAction>>,
  { success: true }
>["data"];

function mapStepsToDraft(steps: CampaignDetail["sequence"]["steps"]): SequenceStepDraft[] {
  return steps.map(mapSequenceStepToDraft);
}

export function CampaignDetailPageContent({
  orgSlug,
  campaignId,
}: {
  orgSlug: string;
  campaignId: string;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<SequenceStepDraft[]>([]);
  const [segments, setSegments] = useState<{ id: string; name: string }[]>([]);
  const [segmentId, setSegmentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [creatingStep, setCreatingStep] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [detailResult, segmentsResult] = await Promise.all([
        getCampaignSequenceAction(campaignId),
        listContactSegmentsAction(),
      ]);
      if (!detailResult.success) {
        toast.error(detailResult.error);
        setDetail(null);
        return;
      }
      setDetail(detailResult.data);
      setName(detailResult.data.sequence.name);
      setSteps(mapStepsToDraft(detailResult.data.sequence.steps));
      if (segmentsResult.success) setSegments(segmentsResult.data);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      const nameResult = await updateCampaignSequenceAction(campaignId, { name: name.trim() });
      if (!nameResult.success) {
        toast.error(nameResult.error);
        return;
      }
      toast.success("Campaign saved");
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleAddStep() {
    if (creatingStep) return;
    setCreatingStep(true);
    try {
      const result = await createCampaignStepAction(campaignId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      router.push(getPathForOrgCampaignStep(orgSlug, campaignId, result.data.id));
    } finally {
      setCreatingStep(false);
    }
  }

  async function handleStartRun() {
    if (!segmentId || starting) return;
    setStarting(true);
    try {
      const result = await startCampaignRunAction(campaignId, segmentId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Campaign run started");
      await load();
    } finally {
      setStarting(false);
    }
  }

  async function handlePause() {
    const result = await pauseCampaignSequenceAction(campaignId);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Campaign paused");
    await load();
  }

  async function handleSendTest() {
    if (sendingTest) return;
    setSendingTest(true);
    try {
      const result = await sendCampaignTestEmailAction(campaignId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Test email sent to your account email");
    } finally {
      setSendingTest(false);
    }
  }

  async function handleDeleteCampaign() {
    if (!detail || saving) return;
    const confirmed = await NiceModal.show(DeleteCampaignConfirmDialog, {
      campaignName: detail.sequence.name,
    });
    if (!confirmed) return;

    setSaving(true);
    try {
      const result = await deleteCampaignSequenceAction(campaignId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Campaign deleted");
      router.push(getPathForOrgCampaigns(orgSlug));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Page className="flex min-h-0 flex-1 flex-col">
        <PageHeaderInOrg title="Campaign" />
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
        <PageHeaderInOrg title="Campaign not found" />
        <PageBody className="p-6">
          <p className="text-muted-foreground">This campaign may have been removed.</p>
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
                  <Link href={getPathForOrgCampaigns(orgSlug)}>Campaigns</Link>
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
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void handleSendTest()} disabled={sendingTest}>
              {sendingTest ? "Sending…" : "Send test"}
            </Button>
            <Button variant="outline" onClick={() => void handlePause()}>
              Pause
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDeleteCampaign()}
              disabled={saving}
            >
              Delete
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        }
      />

      <PageBody className="space-y-6 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <SequenceStatusBadge status={detail.sequence.status} />
          {detail.latestRun && (
            <CampaignRunStatusBadge
              status={detail.latestRun.status}
              startedAt={detail.latestRun.startedAt}
            />
          )}
          <p className="text-sm text-muted-foreground">
            Updated {formatDate(detail.sequence.updatedAt)}
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="campaign-name">Campaign name</Label>
              <Input
                id="campaign-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-3">
              <h3 className="font-semibold">Steps</h3>
              <SequenceStepPreviewList
                steps={steps}
                disabled={creatingStep}
                onAddStep={() => void handleAddStep()}
                getStepHref={(step) => getPathForOrgCampaignStep(orgSlug, campaignId, step.id ?? "")}
                emptyMessage="No steps yet. Add the first email step to this campaign."
              />
            </div>
          </div>

          <div className="space-y-6">
            <div className="space-y-3 rounded-lg border p-4">
              <h3 className="font-semibold">Start run</h3>
              <p className="text-sm text-muted-foreground">
                Enroll contacts from a segment snapshot and begin sending step 1.
              </p>
              <Select value={segmentId} onValueChange={setSegmentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose segment" />
                </SelectTrigger>
                <SelectContent>
                  {segments.map((segment) => (
                    <SelectItem key={segment.id} value={segment.id}>
                      {segment.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                className="w-full"
                disabled={!segmentId || starting}
                onClick={() => void handleStartRun()}
              >
                {starting ? "Starting…" : "Start campaign run"}
              </Button>
            </div>

            <SequenceStatsPanel
              enrollmentCounts={detail.stats.enrollmentCounts}
              perStep={detail.stats.perStep}
            />
          </div>
        </div>
      </PageBody>
    </Page>
  );
}
