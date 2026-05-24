import { vi, describe, it, expect, beforeEach } from "vitest";
import { CURRENT_FILTER_VERSION } from "../schemas/segment-schemas";

vi.mock("@workspace/database", () => ({
  prisma: {
    contactSegment: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { prisma } from "@workspace/database";
import {
  listContactSegmentsForOrg,
  getContactSegmentById,
  createContactSegment,
  updateContactSegment,
  deleteContactSegment,
} from "./contact-segment-repo";

beforeEach(() => vi.clearAllMocks());

describe("listContactSegmentsForOrg", () => {
  it("scopes to organizationId", async () => {
    vi.mocked(prisma.contactSegment.findMany).mockResolvedValue([]);
    await listContactSegmentsForOrg("org_1");
    expect(prisma.contactSegment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org_1" } }),
    );
  });
});

describe("getContactSegmentById", () => {
  it("requires organizationId", async () => {
    vi.mocked(prisma.contactSegment.findFirst).mockResolvedValue(null);
    await getContactSegmentById("cseg_1", "org_1");
    expect(prisma.contactSegment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "cseg_1", organizationId: "org_1" } }),
    );
  });
});

describe("createContactSegment", () => {
  it("generates a cseg_-prefixed ID and sets filterVersion", async () => {
    vi.mocked(prisma.contactSegment.create).mockResolvedValue({} as never);
    await createContactSegment("org_1", "user_1", {
      name: "My Segment",
      filters: {},
      filterVersion: CURRENT_FILTER_VERSION,
      sortKey: "displayName",
      sortDirection: "asc",
    });
    const call = vi.mocked(prisma.contactSegment.create).mock.calls[0]?.[0];
    expect(call?.data.id).toMatch(/^cseg_/);
    expect(call?.data.filterVersion).toBe(CURRENT_FILTER_VERSION);
    expect(call?.data.organizationId).toBe("org_1");
  });
});

describe("updateContactSegment", () => {
  it("scopes update to organizationId and pins filterVersion when filters change", async () => {
    vi.mocked(prisma.contactSegment.update).mockResolvedValue({} as never);
    await updateContactSegment("cseg_1", "org_1", {
      filters: { search: "test" },
      filterVersion: 0 as never, // caller tries to set old version — should be ignored
    });
    const call = vi.mocked(prisma.contactSegment.update).mock.calls[0]?.[0];
    expect(call?.where).toEqual({ id: "cseg_1", organizationId: "org_1" });
    expect(call?.data.filterVersion).toBe(CURRENT_FILTER_VERSION); // pinned to CURRENT_FILTER_VERSION
  });
});

describe("deleteContactSegment", () => {
  it("scopes delete to organizationId", async () => {
    vi.mocked(prisma.contactSegment.delete).mockResolvedValue({} as never);
    await deleteContactSegment("cseg_1", "org_1");
    expect(prisma.contactSegment.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "cseg_1", organizationId: "org_1" } }),
    );
  });
});
