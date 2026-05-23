import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@workspace/database", () => ({
  prisma: {
    contact: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { prisma } from "@workspace/database";
import {
  listContactsForOrg,
  getContactById,
  createContact,
  updateContact,
  archiveContact,
  unarchiveContact,
  countContactsForOrg,
} from "./contact-repo";

const mockContact = {
  id: "contact_abc",
  organizationId: "org_1",
  kind: "person",
  displayName: "Jane Doe",
  firstName: "Jane",
  lastName: "Doe",
  companyName: null,
  primaryEmail: "jane@example.com",
  primaryPhone: null,
  website: null,
  parentContactId: null,
  stageId: null,
  ownerId: null,
  source: null,
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date(),
  archivedAt: null,
  stage: null,
  tags: [],
};

beforeEach(() => vi.clearAllMocks());

describe("listContactsForOrg", () => {
  it("scopes query to organizationId and excludes archived by default", async () => {
    vi.mocked(prisma.contact.findMany).mockResolvedValue([mockContact] as never);
    await listContactsForOrg("org_1", {});
    expect(prisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org_1",
          archivedAt: null,
        }),
      }),
    );
  });

  it("includes archived when requested", async () => {
    vi.mocked(prisma.contact.findMany).mockResolvedValue([]);
    await listContactsForOrg("org_1", { includeArchived: true });
    const call = vi.mocked(prisma.contact.findMany).mock.calls[0]?.[0];
    expect(call?.where).not.toHaveProperty("archivedAt");
  });

  it("does not leak contacts from another organization", async () => {
    vi.mocked(prisma.contact.findMany).mockResolvedValue([]);
    await listContactsForOrg("org_2", {});
    expect(prisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org_2" }),
      }),
    );
  });

  it("filters by tagIds when provided", async () => {
    vi.mocked(prisma.contact.findMany).mockResolvedValue([]);
    await listContactsForOrg("org_1", { tagIds: ["ctag_1", "ctag_2"] });
    const call = vi.mocked(prisma.contact.findMany).mock.calls[0]?.[0];
    expect(call?.where).toMatchObject({
      tags: { some: { tagId: { in: ["ctag_1", "ctag_2"] } } },
    });
  });

  it("applies page and pageSize for pagination", async () => {
    vi.mocked(prisma.contact.findMany).mockResolvedValue([]);
    await listContactsForOrg("org_1", { page: 2, pageSize: 10 });
    const call = vi.mocked(prisma.contact.findMany).mock.calls[0]?.[0];
    expect(call?.skip).toBe(10);
    expect(call?.take).toBe(10);
  });
});

describe("getContactById", () => {
  it("requires organizationId in query", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(mockContact as never);
    await getContactById("contact_abc", "org_1");
    expect(prisma.contact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "contact_abc", organizationId: "org_1" },
      }),
    );
  });
});

describe("createContact", () => {
  it("generates a prefixed ID", async () => {
    vi.mocked(prisma.contact.create).mockResolvedValue(mockContact as never);
    await createContact("org_1", {
      kind: "person",
      displayName: "Jane Doe",
    });
    const call = vi.mocked(prisma.contact.create).mock.calls[0]?.[0];
    expect(call?.data.id).toMatch(/^contact_/);
    expect(call?.data.organizationId).toBe("org_1");
  });
});

describe("archiveContact", () => {
  it("sets archivedAt and requires organizationId", async () => {
    vi.mocked(prisma.contact.update).mockResolvedValue({ ...mockContact, archivedAt: new Date() } as never);
    await archiveContact("contact_abc", "org_1");
    expect(prisma.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "contact_abc", organizationId: "org_1" },
        data: expect.objectContaining({ archivedAt: expect.any(Date) }),
      }),
    );
  });
});

describe("updateContact", () => {
  it("scopes update to organizationId", async () => {
    vi.mocked(prisma.contact.update).mockResolvedValue(mockContact as never);
    await updateContact("contact_abc", "org_1", { displayName: "Jane Smith" });
    expect(prisma.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "contact_abc", organizationId: "org_1" },
        data: { displayName: "Jane Smith" },
      }),
    );
  });
});

describe("unarchiveContact", () => {
  it("sets archivedAt to null and requires organizationId", async () => {
    vi.mocked(prisma.contact.update).mockResolvedValue({ ...mockContact, archivedAt: null } as never);
    await unarchiveContact("contact_abc", "org_1");
    expect(prisma.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "contact_abc", organizationId: "org_1" },
        data: { archivedAt: null },
      }),
    );
  });
});

describe("countContactsForOrg", () => {
  it("counts active (non-archived) contacts for the given org", async () => {
    vi.mocked(prisma.contact.count).mockResolvedValue(7 as never);
    const result = await countContactsForOrg("org_1");
    expect(prisma.contact.count).toHaveBeenCalledWith({
      where: { organizationId: "org_1", archivedAt: null },
    });
    expect(result).toBe(7);
  });
});
