import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/credits", () => ({
  runWithCreditCharge: vi.fn(async ({ run }) => run()),
}));

import { runWithCreditCharge } from "@workspace/credits";
import { runPublicApiWithCredits } from "./credits";

describe("runPublicApiWithCredits", () => {
  beforeEach(() => vi.clearAllMocks());

  it("wraps fixed-cost public API work with org and API key attribution", async () => {
    const result = await runPublicApiWithCredits({
      authContext: {
        kind: "api-key",
        keyId: "key_1",
        ownerType: "organization",
        userId: null,
        orgId: "org_1",
        permissions: {},
      },
      routeId: "GET /v1/account",
      usageArea: "api_route",
      chargeToOrg: true,
      cost: { mode: "fixed", credits: 3 },
      run: async () => "ok",
    });

    expect(result).toBe("ok");
    expect(runWithCreditCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        actor: { kind: "api_key", apiKeyId: "key_1", userId: null },
        source: "public_api",
        usageArea: "api_route",
        chargeToOrg: true,
        cost: { mode: "fixed", credits: 3 },
        metadata: { routeId: "GET /v1/account", authKind: "api-key" },
      }),
    );
  });
});
