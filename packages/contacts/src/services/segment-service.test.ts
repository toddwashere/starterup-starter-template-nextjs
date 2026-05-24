// packages/contacts/src/services/segment-service.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/database", () => ({
  prisma: {
    contact: { findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("../data-models/contact-segment-repo", () => ({
  getContactSegmentById: vi.fn(),
}));

import { prisma } from "@workspace/database";
import { getContactSegmentById } from "../data-models/contact-segment-repo";
import {
  validateSegmentFilters,
  buildContactWhereFromSegment,
  buildSegmentMembershipWhere,
  countContactsForSegment,
} from "./segment-service";

describe("validateSegmentFilters", () => {
  it("accepts valid v1 filters", () => {
    const result = validateSegmentFilters({ kind: "person", stageId: "cstage_abc" }, 1);
    expect(result.kind).toBe("person");
  });

  it("accepts valid v2 filters with contactIds", () => {
    expect(validateSegmentFilters({ contactIds: ["c1"] }, 2)).toEqual({ contactIds: ["c1"] });
  });

  it("accepts v1 filter with search field", () => {
    expect(validateSegmentFilters({ search: "a" }, 1)).toEqual({ search: "a" });
  });

  it("rejects unsupported filterVersion (v3+)", () => {
    expect(() => validateSegmentFilters({}, 3)).toThrow(/Unsupported/);
  });

  it("rejects unknown filter keys (strict mode)", () => {
    expect(() => validateSegmentFilters({ unknownField: true }, 1)).toThrow();
  });

  it("accepts empty filters object", () => {
    expect(() => validateSegmentFilters({}, 1)).not.toThrow();
  });
});

describe("buildContactWhereFromSegment", () => {
  it("builds organizationId-scoped where clause", () => {
    const where = buildContactWhereFromSegment("org_1", { kind: "company" });
    expect(where.organizationId).toBe("org_1");
    expect(where.kind).toBe("company");
  });

  it("excludes archived contacts by default", () => {
    const where = buildContactWhereFromSegment("org_1", {});
    expect(where.archivedAt).toBeNull();
  });

  it("includes archived when filter requests it", () => {
    const where = buildContactWhereFromSegment("org_1", { includeArchived: true });
    expect(where).not.toHaveProperty("archivedAt");
  });

  it("builds tagIds filter with AND semantics (contact must have ALL tags)", () => {
    const where = buildContactWhereFromSegment("org_1", { tagIds: ["ctag_1", "ctag_2"] });
    expect(where.AND).toEqual([
      { tags: { some: { tagId: "ctag_1" } } },
      { tags: { some: { tagId: "ctag_2" } } },
    ]);
  });
});

describe("buildSegmentMembershipWhere", () => {
  it("returns the dynamic where when no contactIds are present", () => {
    const where = buildSegmentMembershipWhere("org_1", { kind: "person" });
    expect(where).toEqual(buildContactWhereFromSegment("org_1", { kind: "person" }));
  });

  it("ORs dynamic filters with explicit contactIds", () => {
    const where = buildSegmentMembershipWhere("org_1", {
      kind: "person",
      contactIds: ["c1", "c2"],
    });
    expect(where).toEqual({
      organizationId: "org_1",
      OR: [
        buildContactWhereFromSegment("org_1", { kind: "person", contactIds: ["c1", "c2"] }),
        { id: { in: ["c1", "c2"] } },
      ],
    });
  });
});

describe("countContactsForSegment", () => {
  it("uses OR membership semantics for v2 segments with contactIds", async () => {
    vi.mocked(getContactSegmentById).mockResolvedValue({
      id: "seg_1",
      organizationId: "org_1",
      filterVersion: 2,
      filters: { contactIds: ["c1"] },
      sortKey: "displayName",
      sortDirection: "asc",
    } as never);
    vi.mocked(prisma.contact.count).mockResolvedValue(5 as never);

    await countContactsForSegment("org_1", "seg_1");

    const where = vi.mocked(prisma.contact.count).mock.calls[0]?.[0]?.where;
    expect(where).toEqual(buildSegmentMembershipWhere("org_1", { contactIds: ["c1"] }));
  });

  it("throws when the segment is not found", async () => {
    vi.mocked(getContactSegmentById).mockResolvedValue(null as never);
    await expect(countContactsForSegment("org_1", "missing")).rejects.toThrow(/not found/);
  });
});
