import { PolicyPack, validateResourceOfType } from "@pulumi/policy";
import * as pulumi from "@pulumi/pulumi";

/**
 * Guardrails for the GCP sandbox stacks.
 *
 *  - Sandbox stacks must not provision a `GlobalForwardingRule` — sandbox uses
 *    Cloud Run's built-in URLs, no global HTTPS LB. A global LB triples the
 *    monthly bill and is reserved for production (Task 7.1).
 *  - Sandbox Cloud Run services must keep `maxInstanceCount <= 2`.
 *
 * Published via `pulumi policy publish` and enabled per stack in Task 7.2.
 *
 * Note: Pulumi's CrossGuard runtime evaluates each resource individually. We
 * use `pulumi.getStack()` (works because CrossGuard runs inside the Pulumi
 * runtime that knows the active stack) to scope rules to the sandbox stack.
 */

function isSandboxStack(): boolean {
  try {
    return pulumi.getStack() === "sandbox";
  } catch {
    // pulumi.getStack() throws outside a deployment context; treat as not-sandbox.
    return false;
  }
}

new PolicyPack("gcp-sandbox", {
  policies: [
    {
      name: "no-global-forwarding-rules-in-sandbox",
      description:
        "Sandbox stacks must not provision GlobalForwardingRule (no global LB).",
      enforcementLevel: "mandatory",
      validateResource: validateResourceOfType(
        "gcp:compute/globalForwardingRule:GlobalForwardingRule",
        (_resource, _args, reportViolation) => {
          if (!isSandboxStack()) return;
          reportViolation(
            "GlobalForwardingRule (global HTTP(S) LB) is denied in sandbox — sandbox uses default Cloud Run URLs.",
          );
        },
      ),
    },
    {
      name: "max-instance-count-sandbox-cap",
      description:
        "Sandbox Cloud Run services must keep maxInstanceCount <= 2.",
      enforcementLevel: "mandatory",
      validateResource: validateResourceOfType(
        "gcp:cloudrunv2/service:Service",
        (resource, _args, reportViolation) => {
          if (!isSandboxStack()) return;
          const maxCount: unknown =
            resource?.template?.scaling?.maxInstanceCount;
          if (typeof maxCount === "number" && maxCount > 2) {
            reportViolation(
              `Sandbox Cloud Run service has maxInstanceCount=${maxCount}; cap is 2.`,
            );
          }
        },
      ),
    },
  ],
});
