import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireOrgEntitlement } from "./require-org-entitlement";
import { BillingEntitlementError } from "../errors";

vi.mock("./get-org-limits", () => ({
  getOrgLimits: vi.fn(),
}));

import { getOrgLimits } from "./get-org-limits";

describe("requireOrgEntitlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws BillingEntitlementError when usage exceeds limit", async () => {
    vi.mocked(getOrgLimits).mockResolvedValue({ contacts: 1000 });

    await expect(
      requireOrgEntitlement("org-1", "contacts", 1001)
    ).rejects.toBeInstanceOf(BillingEntitlementError);
  });

  it("passes when usage equals the limit (at-limit is allowed)", async () => {
    vi.mocked(getOrgLimits).mockResolvedValue({ contacts: 1000 });

    await expect(
      requireOrgEntitlement("org-1", "contacts", 1000)
    ).resolves.toBeUndefined();
  });

  it("passes when usage is under the limit", async () => {
    vi.mocked(getOrgLimits).mockResolvedValue({ contacts: 1000 });

    await expect(
      requireOrgEntitlement("org-1", "contacts", 500)
    ).resolves.toBeUndefined();
  });

  it("passes for a feature with no configured limit (unlimited)", async () => {
    vi.mocked(getOrgLimits).mockResolvedValue({ contacts: 1000 });

    await expect(
      requireOrgEntitlement("org-1", "unknown_feature", 999999)
    ).resolves.toBeUndefined();
  });
});
