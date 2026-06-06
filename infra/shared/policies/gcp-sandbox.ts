import { PolicyPack, validateResourceOfType } from "@pulumi/policy";
import * as pulumi from "@pulumi/pulumi";
import {
  noGlobalForwardingRulesInSandbox,
  maxInstanceCountSandboxCap,
  noAllUsersOnNonPublicService,
  noPrimitiveRolesOnRuntimeSa,
} from "./gcp-sandbox-validators";
import { APPS } from "../apps.manifest";

const NON_PUBLIC_SERVICE_NAMES = APPS.filter((a) => !a.public).map((a) => `starter-${a.name}`);

/**
 * Guardrails for the GCP sandbox stacks.
 *
 *  - Sandbox stacks must not provision a `GlobalForwardingRule` — sandbox uses
 *    Cloud Run's built-in URLs, no global HTTPS LB. A global LB triples the
 *    monthly bill and is reserved for production (Task 7.1).
 *  - Sandbox Cloud Run services must keep `maxInstanceCount <= 2`.
 *
 * Published via `pulumi policy publish` and enabled per stack in Task 7.2.
 * CrossGuard runs during `pulumi preview` in PR builds (see .github/workflows/deploy-gcp.yml).
 *
 * Pure validation logic lives in `gcp-sandbox-validators.ts` and is unit-tested
 * with Vitest in `gcp-sandbox.test.ts`.
 *
 * Note: Pulumi's CrossGuard runtime evaluates each resource individually. We
 * use `pulumi.getStack()` (works because CrossGuard runs inside the Pulumi
 * runtime that knows the active stack) to scope rules to the sandbox stack.
 */

function currentStack(): string {
  try {
    return pulumi.getStack();
  } catch {
    // pulumi.getStack() throws outside a deployment context; treat as not-sandbox.
    return "";
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
        (_resource, args, reportViolation) => {
          noGlobalForwardingRulesInSandbox(currentStack(), args.type, reportViolation);
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
        (resource, args, reportViolation) => {
          maxInstanceCountSandboxCap(currentStack(), args.type, resource as Parameters<typeof maxInstanceCountSandboxCap>[2], reportViolation);
        },
      ),
    },
    {
      name: "no-allusers-on-non-public-service",
      description: "Workers and other non-public Cloud Run services must not allow allUsers.",
      enforcementLevel: "mandatory",
      validateResource: validateResourceOfType(
        "gcp:cloudrunv2/serviceIamMember:ServiceIamMember",
        (resource, args, reportViolation) => {
          noAllUsersOnNonPublicService(
            args.type,
            resource as { name?: string; member?: string },
            NON_PUBLIC_SERVICE_NAMES,
            reportViolation,
          );
        },
      ),
    },
    {
      name: "no-primitive-roles",
      description: "Primitive owner/editor/viewer roles are denied.",
      enforcementLevel: "mandatory",
      validateResource: validateResourceOfType(
        "gcp:projects/iAMMember:IAMMember",
        (resource, args, reportViolation) => {
          noPrimitiveRolesOnRuntimeSa(
            args.type,
            resource as { role?: string; member?: string },
            reportViolation,
          );
        },
      ),
    },
    {
      // IAMPolicy (gcp:projects/iAMPolicy:IAMPolicy) is not covered here — it is
      // rarely used in this codebase and its nested bindings structure requires a
      // different traversal strategy.
      name: "no-primitive-roles-binding",
      description: "Primitive owner/editor/viewer roles are denied on IAMBinding resources.",
      enforcementLevel: "mandatory",
      validateResource: validateResourceOfType(
        "gcp:projects/iAMBinding:IAMBinding",
        (resource, args, reportViolation) => {
          noPrimitiveRolesOnRuntimeSa(
            args.type,
            resource as { role?: string; member?: string },
            reportViolation,
          );
        },
      ),
    },
  ],
});
