"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  INVITATION_ASSIGNABLE_ORG_ROLE_IDS,
  ORG_ROLE_CATALOG,
} from "@workspace/auth/org-roles";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@workspace/ui/components/form";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { resolveAndHideModal } from "@/common/ui/nice-modal-helpers";
import { inviteMemberAction } from "../data/org-actions";

export type InviteMemberButtonModalProps = {
  organizationId: string;
  orgSlug: string;
};

/**
 * Form-level schema, deliberately distinct from `inviteMemberSchema` in
 * `org-types.ts`: the form only collects `email` + `roles` (the modal
 * supplies `organizationId` from props), and role membership against the
 * invitation-assignable catalog is re-validated server-side by the action.
 */
const inviteFormSchema = z.object({
  email: z.string().email("Invalid email address"),
  roles: z.array(z.string()).min(1, "Select at least one role"),
});

type InviteFormValues = z.infer<typeof inviteFormSchema>;

export const InviteMemberButtonModal = NiceModal.create(
  ({ organizationId, orgSlug }: InviteMemberButtonModalProps) => {
    const modal = useModal();
    const queryClient = useQueryClient();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const form = useForm<InviteFormValues>({
      resolver: zodResolver(inviteFormSchema),
      defaultValues: { email: "", roles: [] },
    });

    useEffect(() => {
      if (!modal.visible) return;
      form.reset({ email: "", roles: [] });
      setError(null);
      setIsSubmitting(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [modal.visible]);

    async function onSubmit(data: InviteFormValues) {
      setIsSubmitting(true);
      setError(null);
      try {
        const result = await inviteMemberAction({
          organizationId,
          email: data.email,
          roles: data.roles,
        });
        if (!result.success) {
          setError(result.error.message);
          return;
        }
        await queryClient.invalidateQueries({
          queryKey: ["organization", orgSlug],
        });
        resolveAndHideModal(modal, result.data);
      } finally {
        setIsSubmitting(false);
      }
    }

    return (
      <Dialog
        open={modal.visible}
        onOpenChange={(open) => {
          if (!open) modal.hide();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Invite member</DialogTitle>
            <DialogDescription>
              Send an invitation to join your organization.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email address</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="colleague@example.com"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="roles"
                render={() => (
                  <FormItem>
                    <FormLabel>Roles</FormLabel>
                    <div className="space-y-2">
                      {INVITATION_ASSIGNABLE_ORG_ROLE_IDS.map((role) => (
                        <FormField
                          key={role}
                          control={form.control}
                          name="roles"
                          render={({ field }) => {
                            const checked = field.value?.includes(role) ?? false;
                            return (
                              <FormItem className="flex flex-row items-start gap-2">
                                <FormControl>
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(isChecked) => {
                                      const current = field.value ?? [];
                                      const next = isChecked
                                        ? [...current, role]
                                        : current.filter(
                                            (value: string) => value !== role,
                                          );
                                      field.onChange(next);
                                    }}
                                  />
                                </FormControl>
                                <FormLabel className="font-normal">
                                  {ORG_ROLE_CATALOG[role].label}
                                </FormLabel>
                              </FormItem>
                            );
                          }}
                        />
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => modal.hide()}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Sending..." : "Send invitation"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    );
  },
);
