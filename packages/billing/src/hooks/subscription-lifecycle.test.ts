import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/database", () => ({
  prisma: {
    organization: { findUnique: vi.fn(), findFirst: vi.fn() },
    member: { findMany: vi.fn() },
  },
}));

import { prisma } from "@workspace/database";
import { resolveOrgBillingContactByOrgId } from "./subscription-lifecycle";

describe("resolveOrgBillingContactByOrgId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves the owner contact for a single-role owner", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      name: "Acme",
    } as never);
    vi.mocked(prisma.member.findMany).mockResolvedValue([
      { role: "owner", user: { email: "owner@acme.test" } },
    ] as never);

    const contact = await resolveOrgBillingContactByOrgId("org_1");
    expect(contact).toEqual({
      recipient: "owner@acme.test",
      organizationName: "Acme",
    });
  });

  it("resolves the owner contact when owner holds CSV multi-roles", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      name: "Acme",
    } as never);
    vi.mocked(prisma.member.findMany).mockResolvedValue([
      { role: "owner,member", user: { email: "owner@acme.test" } },
    ] as never);

    const contact = await resolveOrgBillingContactByOrgId("org_1");
    expect(contact).toEqual({
      recipient: "owner@acme.test",
      organizationName: "Acme",
    });
  });

  it("returns null when the org has no owner", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      name: "Acme",
    } as never);
    vi.mocked(prisma.member.findMany).mockResolvedValue([] as never);

    expect(await resolveOrgBillingContactByOrgId("org_1")).toBeNull();
  });

  it("returns null when the organization is missing", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.member.findMany).mockResolvedValue([
      { role: "owner", user: { email: "owner@acme.test" } },
    ] as never);

    expect(await resolveOrgBillingContactByOrgId("org_1")).toBeNull();
  });
});
