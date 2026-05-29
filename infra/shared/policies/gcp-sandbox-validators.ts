/**
 * Pure validation functions extracted from the GCP sandbox PolicyPack.
 *
 * These functions are decoupled from the Pulumi runtime so they can be unit-tested
 * with Vitest without needing a live Pulumi deployment context.
 *
 * The PolicyPack in `gcp-sandbox.ts` delegates to these functions.
 */

/**
 * Reports a violation if a GlobalForwardingRule is being provisioned in the sandbox stack.
 *
 * Sandbox stacks use Cloud Run's built-in URLs — no global HTTPS LB needed.
 * A GlobalForwardingRule triples the monthly bill and is reserved for production.
 */
export function noGlobalForwardingRulesInSandbox(
  stack: string,
  resourceType: string,
  reportViolation: (msg: string) => void,
): void {
  if (stack !== "sandbox") return;
  if (resourceType !== "gcp:compute/globalForwardingRule:GlobalForwardingRule") return;
  reportViolation(
    "GlobalForwardingRule (global HTTP(S) LB) is denied in sandbox — sandbox uses default Cloud Run URLs.",
  );
}

/**
 * Reports a violation if a Cloud Run service in the sandbox stack has maxInstanceCount > 2.
 *
 * Caps autoscaling to prevent runaway costs during development.
 */
export function maxInstanceCountSandboxCap(
  stack: string,
  resourceType: string,
  resource: { name?: string; template?: { scaling?: { maxInstanceCount?: unknown } } },
  reportViolation: (msg: string) => void,
): void {
  if (stack !== "sandbox") return;
  if (resourceType !== "gcp:cloudrunv2/service:Service") return;
  const maxCount: unknown = resource?.template?.scaling?.maxInstanceCount;
  if (typeof maxCount === "number" && maxCount > 2) {
    reportViolation(
      `Sandbox Cloud Run ${resource.name ?? "service"} has maxInstanceCount=${maxCount}; cap is 2.`,
    );
  }
}
