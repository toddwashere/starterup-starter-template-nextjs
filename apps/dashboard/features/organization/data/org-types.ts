import { z } from "zod";
import { isOrgRoleId, ORG_ROLE_CATALOG } from "@workspace/auth/org-roles";

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

export const updateOrgSchema = createOrgSchema.extend({
  organizationId: z.string().min(1),
});

export type UpdateOrgInput = z.infer<typeof updateOrgSchema>;

// Role membership is validated against the registry (`ORG_ROLE_CATALOG`)
// rather than a hand-duplicated Zod enum, so a new role only needs to be
// added in one place. Each surface (replace / invite / bulk) has its own
// assignability flag — ownership is never assignable through any of them.
const memberAssignableRoleSchema = z
  .string()
  .refine(
    (value) => isOrgRoleId(value) && ORG_ROLE_CATALOG[value].memberAssignable,
    "Role cannot be assigned here",
  );

const invitationAssignableRoleSchema = z
  .string()
  .refine(
    (value) =>
      isOrgRoleId(value) && ORG_ROLE_CATALOG[value].invitationAssignable,
    "Role cannot be assigned by invitation",
  );

const bulkAssignableRoleSchema = z
  .string()
  .refine(
    (value) => isOrgRoleId(value) && ORG_ROLE_CATALOG[value].bulkAssignable,
    "Role cannot be changed in bulk",
  );

export const replaceMemberRolesSchema = z.object({
  organizationId: z.string().min(1),
  memberId: z.string().min(1),
  roles: z.array(memberAssignableRoleSchema).min(1),
});

export type ReplaceMemberRolesInput = z.infer<typeof replaceMemberRolesSchema>;

export const bulkMemberRolesSchema = z.object({
  organizationId: z.string().min(1),
  memberIds: z.array(z.string().min(1)).min(1).max(100),
  operation: z.enum(["add", "remove"]),
  roles: z.array(bulkAssignableRoleSchema).min(1),
});

export type BulkMemberRolesInput = z.infer<typeof bulkMemberRolesSchema>;

export const inviteMemberSchema = z.object({
  organizationId: z.string().min(1),
  email: z.string().email("Invalid email address"),
  roles: z.array(invitationAssignableRoleSchema).min(1),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const transferOwnershipSchema = z.object({
  organizationId: z.string().min(1),
  targetMemberId: z.string().min(1),
});

export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;
