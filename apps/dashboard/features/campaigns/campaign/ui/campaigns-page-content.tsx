"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDate } from "@workspace/common";
import { getPathForOrgCampaign } from "@workspace/routes";
import { Button } from "@workspace/ui/components/button";
import { Page, PageBody } from "@workspace/ui/components/page";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { toast } from "@workspace/ui/components/sonner";
import { IconForAdd } from "@workspace/ui/components/icon-for";
import { PageHeaderInOrg } from "@/common/ui/page-header-in-org";
import {
  createCampaignSequenceAction,
  listCampaignSequencesAction,
  type CampaignSequenceListItem,
} from "../data/campaign-actions";
import { SequenceStatusBadge } from "../../common/ui/sequence-stats-panel";

export function CampaignsPageContent({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignSequenceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listCampaignSequencesAction();
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setCampaigns(result.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    try {
      const slug = `campaign-${Date.now()}`;
      const result = await createCampaignSequenceAction({
        kind: "campaign",
        name: "New campaign",
        slug,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      router.push(getPathForOrgCampaign(orgSlug, result.data.id));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Page className="flex min-h-0 flex-1 flex-col">
      <PageHeaderInOrg
        title="Campaigns"
        description="Multi-step email campaigns sent to a segment snapshot."
        actions={
          <Button onClick={() => void handleCreate()} disabled={creating}>
            <IconForAdd className="mr-2" />
            {creating ? "Creating…" : "New campaign"}
          </Button>
        }
      />

      <PageBody className="p-6">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : campaigns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No campaigns yet. Create one to configure steps and start a run.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Last run</th>
                  <th className="px-4 py-3 font-medium">Steps</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">{campaign.name}</td>
                    <td className="px-4 py-3">
                      <SequenceStatusBadge status={campaign.status} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {campaign.latestRun ? (
                        <span className="capitalize">
                          {campaign.latestRun.status} · {formatDate(campaign.latestRun.startedAt)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">{campaign.steps.length}</td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={getPathForOrgCampaign(orgSlug, campaign.id)}>Open</Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>
    </Page>
  );
}
