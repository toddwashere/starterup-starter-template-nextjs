"use client";

import { createContext, useContext, type ReactNode } from "react";
import { authClient } from "@workspace/auth/client";
import { parseOrgRoles } from "@workspace/common";
import { useQuery } from "@tanstack/react-query";

interface OrgMember {
  id: string;
  userId: string;
  organizationId: string;
  /** Raw Better Auth role field; may be a CSV like "admin,member". Use `roles` for logic. */
  role: string;
  roles: string[];
  createdAt: Date;
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
  };
}

interface OrgInvitation {
  id: string;
  email: string;
  role: "owner" | "admin" | "member";
  status: string;
  organizationId: string;
  expiresAt: Date;
}

type FullOrganization = Awaited<
  ReturnType<typeof authClient.organization.getFullOrganization>
>;

interface OrgContextValue {
  organization: FullOrganization | null;
  members: OrgMember[];
  invitations: OrgInvitation[];
  isLoading: boolean;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({
  orgSlug,
  children,
}: {
  orgSlug: string;
  children: ReactNode;
}) {
  const { data: orgData, isLoading: orgLoading } = useQuery({
    queryKey: ["organization", orgSlug],
    queryFn: async () => {
      return authClient.organization.getFullOrganization({
        query: { organizationSlug: orgSlug },
      });
    },
  });

  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ["members", orgSlug],
    queryFn: async () => {
      const result = await authClient.organization.listMembers({
        query: { organizationId: orgData!.id },
      });
      const members = (result as unknown as { members: OrgMember[] }).members ?? [];
      return members.map((m) => ({ ...m, roles: parseOrgRoles(m.role) }));
    },
    enabled: !!orgData?.id,
  });

  return (
    <OrgContext.Provider
      value={{
        organization: orgData ?? null,
        members: membersData ?? [],
        invitations: orgData?.invitations ?? [],
        isLoading: orgLoading || membersLoading,
      }}
    >
      {children}
    </OrgContext.Provider>
  );
}

export function useCurrentOrg() {
  const context = useContext(OrgContext);
  if (!context) {
    throw new Error("useCurrentOrg must be used within OrgProvider");
  }
  return context;
}
