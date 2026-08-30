import { createId } from "@workspace/common";
import { InsufficientCreditsError, runWithCreditCharge, type CreditCost } from "@workspace/credits";
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

/** Narrow an unknown route error to the credits package's balance error. */
export function isInsufficientCreditsError(err: unknown): err is InsufficientCreditsError {
  return err instanceof InsufficientCreditsError;
}

export async function runPublicApiWithCredits<T>(input: {
  authContext: PublicApiAuthContext;
  routeId: string;
  usageArea: string;
  chargeToOrg?: boolean;
  cost: CreditCost;
  /** Org-scoped routes resolve the org from the path, not the credential. */
  organizationId?: string | null;
  /** Pass the caller's `Idempotency-Key` so retries settle exactly once. */
  idempotencyKey?: string;
  run: () => Promise<T>;
}): Promise<T> {
  const organizationId = input.organizationId ?? input.authContext.orgId;
  if (!organizationId) {
    return input.run();
  }

  return runWithCreditCharge({
    organizationId,
    actor: actorFromAuthContext(input.authContext),
    source: "public_api",
    usageArea: input.usageArea,
    chargeToOrg: input.chargeToOrg,
    cost: input.cost,
    idempotencyKey: `public_api:${input.routeId}:${input.idempotencyKey ?? createId("creduse")}`,
    metadata: {
      routeId: input.routeId,
      authKind: input.authContext.kind,
    },
    run: input.run,
  });
}
