"use client";

import { useEffect, useState, useCallback } from "react";
import NiceModal from "@ebay/nice-modal-react";
import { authClient } from "@workspace/auth/client";
import { Button } from "@workspace/ui/components/button";
import { Page, PageBody } from "@workspace/ui/components/page";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { toast } from "@workspace/ui/components/sonner";
import { PageHeaderInOrg } from "@/common/ui/page-header-in-org";
import { useCurrentOrg } from "@/features/organization/ui/org-provider";
import { ApiKeyTable } from "./api-key-table";
import { ApiKeyCreateModal } from "./api-key-create-modal";
import { listOrgApiKeysAction, revokeApiKeyAction } from "../data/api-key-actions";
import type { ApiKeyRecord } from "../data/api-key-types";

export function ApiKeysPageContent() {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Org API keys are owner/admin-only (see permissions.ts: `apiKey`). Members may
  // open this page but must not call list/create actions (they 403 server-side).
  const { members, isLoading: orgLoading } = useCurrentOrg();
  const { data: session } = authClient.useSession();
  const currentRole =
    members.find((m) => m.userId === session?.user?.id)?.role ?? "member";
  const canManageApiKeys =
    currentRole === "owner" || currentRole === "admin";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listOrgApiKeysAction();
      const raw = result as unknown as { apiKeys?: ApiKeyRecord[] } | ApiKeyRecord[] | null;
      const list = Array.isArray(raw) ? raw : ((raw as { apiKeys?: ApiKeyRecord[] })?.apiKeys ?? []);
      setKeys(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (orgLoading) return;
    if (!canManageApiKeys) {
      setKeys([]);
      setLoading(false);
      return;
    }
    void load();
  }, [load, orgLoading, canManageApiKeys]);

  const handleRevoke = useCallback(async (keyId: string) => {
    try {
      await revokeApiKeyAction(keyId);
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to revoke API key.";
      toast.error(message);
    }
  }, [load]);

  const handleCreate = useCallback(async () => {
    try {
      const created = await NiceModal.show(ApiKeyCreateModal);
      if (created) await load();
    } catch {
      // ignore modal dismissal
    }
  }, [load]);

  return (
    <Page className="flex min-h-0 flex-1 flex-col">
      <PageHeaderInOrg
        title="API Keys"
        description="Manage keys for third-party integrations and AI agents."
        actions={
          orgLoading ? (
            <Skeleton className="h-9 w-24" />
          ) : canManageApiKeys ? (
            <Button onClick={() => void handleCreate()}>Create Key</Button>
          ) : undefined
        }
      />
      <PageBody disableScroll className="space-y-6 p-6">
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ApiKeyTable keys={keys} onRevoke={(id) => void handleRevoke(id)} />
      )}
      </PageBody>
    </Page>
  );
}
