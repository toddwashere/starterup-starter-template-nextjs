"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDate } from "@workspace/common";
import { getPathForOrgFollowUp } from "@workspace/routes";
import { Button } from "@workspace/ui/components/button";
import { Page, PageBody } from "@workspace/ui/components/page";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { toast } from "@workspace/ui/components/sonner";
import { IconForAdd } from "@workspace/ui/components/icon-for";
import { PageHeaderInOrg } from "@/common/ui/page-header-in-org";
import {
  createFollowUpSequenceAction,
  listFollowUpSequencesAction,
} from "../data/follow-up-actions";
import { SequenceStatusBadge } from "../../common/ui/sequence-stats-panel";

type FollowUpSequence = Extract<
  Awaited<ReturnType<typeof listFollowUpSequencesAction>>,
  { success: true }
>["data"][number];

export function FollowUpsPageContent({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const [followUps, setFollowUps] = useState<FollowUpSequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listFollowUpSequencesAction();
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setFollowUps(result.data);
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
      const slug = `follow-up-${Date.now()}`;
      const result = await createFollowUpSequenceAction({
        kind: "follow_up",
        name: "New follow-up",
        slug,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      router.push(getPathForOrgFollowUp(orgSlug, result.data.id));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Page className="flex min-h-0 flex-1 flex-col">
      <PageHeaderInOrg
        title="Follow-ups"
        description="Explicit multi-step email sequences enrolled per contact."
        actions={
          <Button onClick={() => void handleCreate()} disabled={creating}>
            <IconForAdd className="mr-2" />
            {creating ? "Creating…" : "New follow-up"}
          </Button>
        }
      />

      <PageBody className="p-6">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : followUps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No follow-ups yet. Create one, then enroll contacts from the contact list or detail
            page.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                  <th className="px-4 py-3 font-medium">Steps</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {followUps.map((followUp) => (
                  <tr key={followUp.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">{followUp.name}</td>
                    <td className="px-4 py-3">
                      <SequenceStatusBadge status={followUp.status} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(followUp.updatedAt)}
                    </td>
                    <td className="px-4 py-3">{followUp.steps.length}</td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={getPathForOrgFollowUp(orgSlug, followUp.id)}>Open</Link>
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
