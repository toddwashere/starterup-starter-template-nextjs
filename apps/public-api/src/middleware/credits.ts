import { createId } from "@workspace/common";
import { runWithCreditCharge, type CreditCost } from "@workspace/credits";
import type { PublicApiAuthContext } from "@workspace/auth/public-api";

function actorFromAuthContext(authContext: PublicApiAuthContext) {
  if (authContext.kind === "api-key") {
    return {
      kind: "api_key" as const,
      apiKeyId: authContext.keyId,
      userId: authContext.userId,
    };
  }

  return {
    kind: "oauth_client" as const,
    oauthClientId: authContext.clientId ?? "unknown",
    userId: authContext.userId,
  };
}

export async function runPublicApiWithCredits<T>(input: {
  authContext: PublicApiAuthContext;
  routeId: string;
  usageArea: string;
  chargeToOrg?: boolean;
  cost: CreditCost;
  run: () => Promise<T>;
}): Promise<T> {
  if (!input.authContext.orgId) {
    return input.run();
  }

  return runWithCreditCharge({
    organizationId: input.authContext.orgId,
    actor: actorFromAuthContext(input.authContext),
    source: "public_api",
    usageArea: input.usageArea,
    chargeToOrg: input.chargeToOrg,
    cost: input.cost,
    idempotencyKey: `public_api:${input.routeId}:${createId("creduse")}`,
    metadata: {
      routeId: input.routeId,
      authKind: input.authContext.kind,
    },
    run: input.run,
  });
}
