import type { OrgRoleId } from "./index";

export type OrgRoleMetadata = {
  label: string;
  description: string;
  order: number;
  managementRank: number;
  ownership: boolean;
  memberAssignable: boolean;
  invitationAssignable: boolean;
  bulkAssignable: boolean;
};

export const ORG_ROLE_CATALOG = {
  owner: {
    label: "Owner",
    description: "Full organization control, including ownership transfer.",
    order: 10,
    managementRank: 30,
    ownership: true,
    memberAssignable: false,
    invitationAssignable: false,
    bulkAssignable: false,
  },
  admin: {
    label: "Admin",
    description: "Manage organization settings, members, and product data.",
    order: 20,
    managementRank: 20,
    ownership: false,
    memberAssignable: true,
    invitationAssignable: true,
    bulkAssignable: true,
  },
  member: {
    label: "Member",
    description: "Use organization product features without administration.",
    order: 30,
    managementRank: 10,
    ownership: false,
    memberAssignable: true,
    invitationAssignable: true,
    bulkAssignable: true,
  },
} as const satisfies Record<OrgRoleId, OrgRoleMetadata>;

export class InvalidOrgRoleSetError extends Error {
  constructor(
    public readonly code: "EMPTY_ROLE_SET" | "UNKNOWN_ROLE",
    message: string,
  ) {
    super(message);
  }
}

export function isOrgRoleId(value: string): value is OrgRoleId {
  return Object.hasOwn(ORG_ROLE_CATALOG, value);
}

export function normalizeOrgRoleIds(values: readonly string[]): OrgRoleId[] {
  if (values.length === 0) {
    throw new InvalidOrgRoleSetError("EMPTY_ROLE_SET", "Select at least one role.");
  }
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (unique.some((value) => !isOrgRoleId(value))) {
    throw new InvalidOrgRoleSetError("UNKNOWN_ROLE", "Role configuration is out of date.");
  }
  return (unique as OrgRoleId[]).sort(
    (a, b) => ORG_ROLE_CATALOG[a].order - ORG_ROLE_CATALOG[b].order,
  );
}

export function getHighestManagementRank(values: readonly string[]): number {
  const roles = normalizeOrgRoleIds(values);
  return Math.max(...roles.map((role) => ORG_ROLE_CATALOG[role].managementRank));
}

export function hasOwnershipRole(values: readonly string[]): boolean {
  return normalizeOrgRoleIds(values).some((role) => ORG_ROLE_CATALOG[role].ownership);
}

export const MEMBER_ASSIGNABLE_ORG_ROLE_IDS = Object.keys(ORG_ROLE_CATALOG).filter(
  (role): role is OrgRoleId =>
    isOrgRoleId(role) && ORG_ROLE_CATALOG[role].memberAssignable,
);

export const INVITATION_ASSIGNABLE_ORG_ROLE_IDS = Object.keys(
  ORG_ROLE_CATALOG,
).filter(
  (role): role is OrgRoleId =>
    isOrgRoleId(role) && ORG_ROLE_CATALOG[role].invitationAssignable,
);

export const BULK_ASSIGNABLE_ORG_ROLE_IDS = Object.keys(ORG_ROLE_CATALOG).filter(
  (role): role is OrgRoleId =>
    isOrgRoleId(role) && ORG_ROLE_CATALOG[role].bulkAssignable,
);
