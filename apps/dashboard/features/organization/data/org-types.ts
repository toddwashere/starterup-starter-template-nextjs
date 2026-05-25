import { z } from "zod";

export const createOrgSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(50, "Name must be at most 50 characters"),
  slug: z
    .string()
    .min(2, "Slug must be at least 2 characters")
    .max(50, "Slug must be at most 50 characters")
    .regex(
      /^[a-z0-9-]+$/,
      "Slug can only contain lowercase letters, numbers, and hyphens",
    ),
});

export type CreateOrgInput = z.infer<typeof createOrgSchema>;

export const inviteMemberSchema = z.object({
  email: z.string().email("Invalid email address"),
  role: z.enum(["admin", "member"], {
    errorMap: () => ({ message: "Role must be admin or member" }),
  }),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const updateMemberRoleSchema = z.object({
  memberId: z.string().min(1),
  role: z.array(z.enum(["owner", "admin", "member"])).min(1, "Select at least one role"),
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
