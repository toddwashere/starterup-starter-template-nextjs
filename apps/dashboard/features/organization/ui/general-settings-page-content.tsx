"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import NiceModal from "@ebay/nice-modal-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@workspace/common";
import { getPathForOrgSettingsGeneral } from "@workspace/routes";
import { invalidateOrganizationList } from "@workspace/auth/client";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@workspace/ui/components/form";
import { Page, PageBody } from "@workspace/ui/components/page";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { toast } from "@workspace/ui/components/sonner";
import { PageHeaderInOrg } from "@/common/ui/page-header-in-org";
import {
  updateOrgSchema,
  type UpdateOrgInput,
} from "@/features/organization/data/org-types";
import { updateOrganizationAction } from "@/features/organization/data/org-actions";
import { getOrgUpdateContextAction } from "@/features/organization/data/org-permission-actions";
import { ChangeOrgSlugConfirmDialog } from "./change-org-slug-confirm-dialog";
import { useCurrentOrg } from "./org-provider";

export function GeneralSettingsPageContent({
  orgSlug,
}: {
  orgSlug: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { organization, isLoading } = useCurrentOrg();
  const [formError, setFormError] = useState<string | null>(null);

  const { data: updateContext, isLoading: permissionLoading } = useQuery({
    queryKey: ["org-update-context", organization?.id],
    queryFn: () => getOrgUpdateContextAction(organization!.id),
    enabled: Boolean(organization?.id),
  });

  const canUpdate = updateContext?.canUpdate === true;
  const showSkeleton = isLoading || !organization || permissionLoading;

  const form = useForm<UpdateOrgInput>({
    resolver: zodResolver(updateOrgSchema),
    defaultValues: {
      organizationId: "",
      name: "",
      slug: "",
    },
  });

  useEffect(() => {
    if (!organization) return;
    form.reset({
      organizationId: organization.id,
      name: organization.name,
      slug: organization.slug,
    });
  }, [organization, form]);

  const onSubmit = async (data: UpdateOrgInput) => {
    if (!organization || !canUpdate) return;

    const slugChanged = data.slug !== organization.slug;
    if (slugChanged) {
      const confirmed = await NiceModal.show(ChangeOrgSlugConfirmDialog, {
        currentSlug: organization.slug,
        nextSlug: data.slug,
      });
      if (!confirmed) return;
    }

    setFormError(null);
    const result = await updateOrganizationAction(data);
    if (!result.success) {
      if (result.error.code === "SLUG_TAKEN") {
        form.setError("slug", { message: result.error.message });
      } else {
        setFormError(result.error.message);
      }
      return;
    }

    await queryClient.invalidateQueries({ queryKey: ["organization"] });
    await queryClient.invalidateQueries({
      queryKey: ["org-update-context", organization.id],
    });
    // Org switcher uses better-auth's list atom, not React Query.
    invalidateOrganizationList();

    toast.success("Organization settings saved");

    if (slugChanged) {
      router.replace(getPathForOrgSettingsGeneral(result.data.slug));
      return;
    }

    form.reset({
      organizationId: result.data.id,
      name: result.data.name,
      slug: result.data.slug,
    });
  };

  return (
    <Page className="flex min-h-0 flex-1 flex-col">
      <PageHeaderInOrg
        title="General Settings"
        description="Manage your organization's general settings."
      />
      <PageBody disableScroll className="space-y-6 p-6">
        {showSkeleton ? (
          <Skeleton className="h-52 w-full" />
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Organization Details</CardTitle>
                  <CardDescription>
                    Basic information about your organization.
                    {!canUpdate
                      ? " You need admin access to edit these settings."
                      : null}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            disabled={!canUpdate || form.formState.isSubmitting}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="slug"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Slug</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            className="font-mono"
                            disabled={!canUpdate || form.formState.isSubmitting}
                          />
                        </FormControl>
                        <FormDescription>
                          Used in URLs like /{field.value || orgSlug}/…
                          Changing this breaks existing links.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid gap-1">
                    <span className="text-sm font-medium text-muted-foreground">
                      Created
                    </span>
                    <span className="text-sm">
                      {formatDate(organization.createdAt)}
                    </span>
                  </div>
                  {formError ? (
                    <p className="text-sm text-destructive">{formError}</p>
                  ) : null}
                </CardContent>
                {canUpdate ? (
                  <CardFooter className="justify-end">
                    <Button
                      type="submit"
                      disabled={
                        form.formState.isSubmitting || !form.formState.isDirty
                      }
                    >
                      {form.formState.isSubmitting
                        ? "Saving..."
                        : "Save changes"}
                    </Button>
                  </CardFooter>
                ) : null}
              </Card>
            </form>
          </Form>
        )}
      </PageBody>
    </Page>
  );
}
