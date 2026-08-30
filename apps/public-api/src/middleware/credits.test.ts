import { beforeEach, describe, expect, it, vi } from "vitest";

const { chargedCredits } = vi.hoisted(() => ({ chargedCredits: [] as number[] }));

vi.mock("@workspace/credits", () => ({
  InsufficientCreditsError: class extends Error {},
  runWithCreditCharge: vi.fn(async ({ run }) => run()),
}));

import { runWithCreditCharge } from "@workspace/credits";
import { runPublicApiWithCredits } from "./credits";

describe("runPublicApiWithCredits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chargedCredits.length = 0;
    vi.mocked(runWithCreditCharge).mockImplementation((({ run }: { run: () => Promise<unknown> }) =>
      run()) as unknown as typeof runWithCreditCharge);
  });

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

describe("runPublicApiWithCredits failure and attribution rules", () => {
  const ORG_KEY_CONTEXT = {
    kind: "api-key",
    keyId: "key_1",
    ownerType: "organization",
    userId: null,
    orgId: "org_1",
    permissions: {},
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    // Mirrors the real helper: credits settle only after the work resolves.
    vi.mocked(runWithCreditCharge).mockImplementation((async ({
      run,
      cost,
    }: {
      run: () => Promise<unknown>;
      cost: { credits: number };
    }) => {
      const result = await run();
      chargedCredits.push(cost.credits);
      return result;
    }) as unknown as typeof runWithCreditCharge);
  });

  it("does not charge credits when the wrapped route work fails", async () => {
    await expect(
      runPublicApiWithCredits({
        authContext: ORG_KEY_CONTEXT,
        routeId: "GET /v1/failing",
        usageArea: "api_route",
        chargeToOrg: true,
        cost: { mode: "fixed", credits: 3 },
        run: async () => {
          throw new Error("route exploded");
        },
      }),
    ).rejects.toThrow("route exploded");

    expect(runWithCreditCharge).toHaveBeenCalledTimes(1);
    expect(chargedCredits).toEqual([]);
  });

  it("runs the work without touching credits when there is no organization", async () => {
    const result = await runPublicApiWithCredits({
      authContext: { ...ORG_KEY_CONTEXT, orgId: null },
      routeId: "GET /v1/account",
      usageArea: "api_route",
      chargeToOrg: true,
      cost: { mode: "fixed", credits: 3 },
      run: async () => "ok",
    });

    expect(result).toBe("ok");
    expect(runWithCreditCharge).not.toHaveBeenCalled();
  });

  it("uses a caller-supplied idempotency key so retries settle once", async () => {
    await runPublicApiWithCredits({
      authContext: ORG_KEY_CONTEXT,
      routeId: "GET /v1/orgs/{orgId}/ping",
      usageArea: "api_route",
      cost: { mode: "fixed", credits: 1 },
      idempotencyKey: "req_1",
      run: async () => "ok",
    });

    expect(runWithCreditCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "public_api:GET /v1/orgs/{orgId}/ping:req_1",
      }),
    );
  });
});
