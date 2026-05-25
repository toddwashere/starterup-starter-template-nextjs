"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@workspace/auth/client";
import { getPathForOrg, getPathForCreateOrg } from "@workspace/routes";
import {
  Avatar,
  AvatarFallback,
} from "@workspace/ui/components/avatar";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
} from "@workspace/ui/components/card";
import { Page, PageBody } from "@workspace/ui/components/page";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { IconForAdd } from "@workspace/ui/components/icon-for";
import { PageHeaderNoOrg } from "@/common/ui/page-header-no-org";

export function OrgPickerPageContent() {
  const router = useRouter();
  const { data: orgsResult, isPending } = authClient.useListOrganizations();
  const organizations = orgsResult ?? [];

  const handleSelectOrg = async (orgId: string, slug: string) => {
    await authClient.organization.setActive({ organizationId: orgId });
    router.push(getPathForOrg(slug));
  };

  if (isPending) {
    return (
      <Page className="flex min-h-0 flex-1 flex-col">
        <PageHeaderNoOrg
          title="Your Organizations"
          description="Select an organization to continue."
        />
        <PageBody disableScroll className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </PageBody>
      </Page>
    );
  }

  if (organizations.length === 0) {
    return (
      <Page className="flex min-h-0 flex-1 flex-col">
        <PageHeaderNoOrg
          title="Welcome"
          description="Create your first organization to get started."
        />
        <PageBody
          disableScroll
          className="flex flex-col items-center justify-center py-20 text-center"
        >
          <Button onClick={() => router.push(getPathForCreateOrg())}>
            <IconForAdd className="mr-2" />
            Create Organization
          </Button>
        </PageBody>
      </Page>
    );
  }

  return (
    <Page className="flex min-h-0 flex-1 flex-col">
      <PageHeaderNoOrg
        title="Your Organizations"
        description="Select an organization to continue."
      />
      <PageBody disableScroll className="space-y-6">
        <div className="space-y-3">
          {organizations.map((org) => (
            <Card
              key={org.id}
              className="cursor-pointer transition-colors hover:bg-accent"
              onClick={() => handleSelectOrg(org.id, org.slug)}
              data-testid={`org-picker-${org.slug}`}
            >
              <CardContent className="flex items-center gap-4 p-4">
                <Avatar className="size-10">
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    {org.name.slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <p className="font-medium">{org.name}</p>
                  <p className="text-sm text-muted-foreground">{org.slug}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => router.push(getPathForCreateOrg())}
        >
          <IconForAdd className="mr-2" />
          Create Organization
        </Button>
      </PageBody>
    </Page>
  );
}
