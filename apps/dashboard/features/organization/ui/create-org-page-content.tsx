"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { authClient } from "@workspace/auth/client";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
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
import { getPathForOrg } from "@workspace/routes";
import { Page, PageBody } from "@workspace/ui/components/page";
import { PageHeaderNoOrg } from "@/common/ui/page-header-no-org";
import {
  createOrgSchema,
  type CreateOrgInput,
} from "@/features/organization/data/org-types";
import { slugify } from "@/features/organization/data/slugify";

export function CreateOrgPageContent() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slugTouched = useRef(false);

  const form = useForm<CreateOrgInput>({
    resolver: zodResolver(createOrgSchema),
    defaultValues: { name: "", slug: "" },
  });

  const onNameChange = (value: string) => {
    form.setValue("name", value);
    if (!slugTouched.current) {
      form.setValue("slug", slugify(value), { shouldValidate: true });
    }
  };

  const onSubmit = async (data: CreateOrgInput) => {
    setIsSubmitting(true);
    setError(null);
    try {
      await authClient.organization.create({
        name: data.name,
        slug: data.slug,
      });
      router.push(getPathForOrg(data.slug));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create organization");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Page className="flex min-h-0 flex-1 flex-col">
      <PageHeaderNoOrg
        title="Create Organization"
        description="Set up a new organization to collaborate with your team."
      />
      <PageBody disableScroll className="mx-auto w-full max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle>Organization details</CardTitle>
          <CardDescription>
            Choose a name and URL slug for your organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Organization Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Acme Inc"
                        {...field}
                        onChange={(e) => onNameChange(e.target.value)}
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
                    <FormLabel>URL Slug</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="acme-inc"
                        {...field}
                        onChange={(e) => {
                          field.onChange(e);
                          slugTouched.current = true;
                        }}
                      />
                    </FormControl>
                    <FormDescription>
                      This will be used in your organization&apos;s URL.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create Organization"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
      </PageBody>
    </Page>
  );
}
