import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrgPermissionWithActiveOrg } from "@workspace/auth/guards";
import { exportContactsByIdsAction } from "./contact-csv-actions";

vi.mock("@workspace/auth/guards", () => ({
  requireOrgPermissionWithActiveOrg: vi.fn().mockResolvedValue({
    session: { user: { id: "user_1" } },
    activeOrganizationId: "org_1",
  }),
}));

vi.mock("@workspace/contacts", () => ({
  listContactsByIds: vi.fn(),
  listContactsForOrg: vi.fn(),
  listContactsForSegment: vi.fn(),
  exportContactsToCsv: vi.fn().mockReturnValue("csv-data"),
  formatContactTagsForCsv: vi.fn().mockReturnValue(""),
  parseContactsCsv: vi.fn(),
  createContactWithValidation: vi.fn(),
  parseTagNamesFromCsv: vi.fn(),
  setContactTagsForContact: vi.fn(),
}));

import { listContactsByIds } from "@workspace/contacts";

describe("exportContactsByIdsAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires contact export permission", async () => {
    vi.mocked(listContactsByIds).mockResolvedValue([
      { id: "c1", displayName: "A", kind: "person", tags: [] },
    ] as never);
    await exportContactsByIdsAction(["c1"]);
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenCalledWith({ contact: ["export"] });
  });

  it("fails when fewer contacts are found than requested", async () => {
    vi.mocked(listContactsByIds).mockResolvedValue([] as never);
    const result = await exportContactsByIdsAction(["c1", "c2"]);
    expect(result.success).toBe(false);
  });

  it("rejects more than 1000 ids without querying", async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `c${i}`);
    const result = await exportContactsByIdsAction(ids);
    expect(result.success).toBe(false);
    expect(listContactsByIds).not.toHaveBeenCalled();
  });
});
