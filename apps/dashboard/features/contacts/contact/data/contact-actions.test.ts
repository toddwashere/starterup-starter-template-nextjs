import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrgPermissionWithActiveOrg } from "@workspace/auth/guards";
import { requireOrgEntitlement } from "@workspace/billing";
import { listContactsForOrg, countContactsMatchingListFilters } from "@workspace/contacts";
import {
  archiveContactAction,
  createContactAction,
  getContactAction,
  listContactsAction,
  updateContactAction,
} from "./contact-actions";

vi.mock("@workspace/auth/guards", () => ({
  requireOrgPermissionWithActiveOrg: vi.fn().mockResolvedValue({
    session: { user: { id: "user_1" } },
    activeOrganizationId: "org_1",
  }),
}));

vi.mock("@workspace/contacts", () => ({
  listContactsForOrg: vi.fn().mockResolvedValue([]),
  getContactById: vi.fn().mockResolvedValue({ id: "contact_1" }),
  createContactWithValidation: vi.fn().mockResolvedValue({ id: "contact_1" }),
  updateContactWithValidation: vi.fn().mockResolvedValue({ id: "contact_1" }),
  archiveContact: vi.fn().mockResolvedValue({ id: "contact_1" }),
  countContactsForOrg: vi.fn().mockResolvedValue(0),
  countContactsMatchingListFilters: vi.fn().mockResolvedValue(0),
}));

// Defined via vi.hoisted so the class exists when the (hoisted) vi.mock factory runs.
const { BillingEntitlementError } = vi.hoisted(() => {
  class BillingEntitlementError extends Error {
    constructor() {
      super("Billing limit reached");
      this.name = "BillingEntitlementError";
    }
  }
  return { BillingEntitlementError };
});

vi.mock("@workspace/billing", () => ({
  requireOrgEntitlement: vi.fn().mockResolvedValue(undefined),
  BillingEntitlementError,
}));

describe("contact actions permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires contact read permission for list and get", async () => {
    await listContactsAction();
    await getContactAction("contact_1");

    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(1, {
      contact: ["read"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(2, {
      contact: ["read"],
    });
  });

  it("requires contact create permission for create", async () => {
    await createContactAction({
      kind: "person",
      displayName: "Jane Doe",
    });

    expect(requireOrgPermissionWithActiveOrg).toHaveBeenCalledWith({
      contact: ["create"],
    });
  });

  it("blocks create and returns a friendly error when over the plan limit", async () => {
    vi.mocked(requireOrgEntitlement).mockRejectedValueOnce(
      new BillingEntitlementError(),
    );

    const result = await createContactAction({
      kind: "person",
      displayName: "Jane Doe",
    });

    expect(result).toEqual({
      success: false,
      error:
        "You've reached your plan's contact limit. Upgrade your plan to add more contacts.",
    });
  });

  it("requires contact update permission for update", async () => {
    await updateContactAction("contact_1", { displayName: "Jane Updated" });

    expect(requireOrgPermissionWithActiveOrg).toHaveBeenCalledWith({
      contact: ["update"],
    });
  });

  it("requires contact delete permission for archive", async () => {
    await archiveContactAction("contact_1");

    expect(requireOrgPermissionWithActiveOrg).toHaveBeenCalledWith({
      contact: ["delete"],
    });
  });
});

describe("listContactsAction shape", () => {
  it("returns rows and totalCount", async () => {
    vi.mocked(listContactsForOrg).mockResolvedValue([{ id: "c1" }] as never);
    vi.mocked(countContactsMatchingListFilters).mockResolvedValue(1 as never);
    const result = await listContactsAction();
    expect(result).toEqual({
      success: true,
      data: { rows: [{ id: "c1" }], totalCount: 1 },
    });
  });
});
