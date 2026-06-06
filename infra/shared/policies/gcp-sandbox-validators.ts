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

/**
 * Flags an `allUsers` Cloud Run IAM binding on a service that is NOT in the
 * public-services allowlist (workers must never be publicly invokable).
 */
export function noAllUsersOnNonPublicService(
  resourceType: string,
  resource: { name?: string; member?: string },
  nonPublicServiceNames: readonly string[],
  reportViolation: (msg: string) => void,
): void {
  if (resourceType !== "gcp:cloudrunv2/serviceIamMember:ServiceIamMember") return;
  if (resource.member !== "allUsers" && resource.member !== "allAuthenticatedUsers") return;
  if (nonPublicServiceNames.some((n) => (resource.name ?? "").includes(n))) {
    reportViolation(
      `Cloud Run service ${resource.name ?? "?"} must not allow ${resource.member} (non-public service).`,
    );
  }
}

/**
 * Flags primitive owner/editor/viewer roles bound to any member — runtime and
 * deploy SAs must use least-privilege predefined roles, never primitives.
 */
export function noPrimitiveRolesOnRuntimeSa(
  resourceType: string,
  resource: { role?: string; member?: string },
  reportViolation: (msg: string) => void,
): void {
  if (!resourceType.toLowerCase().includes("iammember")) return;
  const primitive = ["roles/owner", "roles/editor", "roles/viewer"];
  if (resource.role && primitive.includes(resource.role)) {
    reportViolation(
      `Primitive role ${resource.role} bound to ${resource.member ?? "?"} is denied; use least-privilege roles.`,
    );
  }
}
