import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrgPermissionWithActiveOrg } from "@workspace/auth/guards";
import { addContactsToSegmentAction } from "./contact-segment-actions";

vi.mock("@workspace/auth/guards", () => ({
  requireOrgPermissionWithActiveOrg: vi.fn().mockResolvedValue({
    session: { user: { id: "user_1" } },
    activeOrganizationId: "org_1",
  }),
}));

vi.mock("@workspace/contacts", () => ({
  listContactSegmentsForOrg: vi.fn(),
  createContactSegment: vi.fn(),
  deleteContactSegment: vi.fn(),
  listContactsForSegment: vi.fn(),
  addContactsToSegment: vi.fn().mockResolvedValue({ addedCount: 2, totalExplicitIds: 2 }),
}));

import { addContactsToSegment } from "@workspace/contacts";

describe("addContactsToSegmentAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires contactSettings update permission and delegates ids to the service", async () => {
    const result = await addContactsToSegmentAction("seg_1", ["c1", "c2"]);
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenCalledWith({
      contactSettings: ["update"],
    });
    expect(addContactsToSegment).toHaveBeenCalledWith("org_1", "seg_1", ["c1", "c2"]);
    expect(result).toEqual({ success: true, data: { addedCount: 2, totalExplicitIds: 2 } });
  });

  it("rejects an empty selection without calling the service", async () => {
    const result = await addContactsToSegmentAction("seg_1", []);
    expect(result.success).toBe(false);
    expect(addContactsToSegment).not.toHaveBeenCalled();
  });

  it("rejects more than 1000 ids without calling the service", async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `c${i}`);
    const result = await addContactsToSegmentAction("seg_1", ids);
    expect(result.success).toBe(false);
    expect(addContactsToSegment).not.toHaveBeenCalled();
  });
});
