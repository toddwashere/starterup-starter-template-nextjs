# AWS Deployment Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AWS deployment identity configurable for downstream repositories while preserving the starter template's existing AWS names by default.

**Architecture:** `infra/aws/naming.ts` resolves one canonical identity from the non-secret operator environment and exposes small pure helpers for global names, account-local names, tags, ECR paths, secret/log paths, and deploy-role names. Bootstrap, core, apps, and state bootstrap consume those helpers, so created resource names and every IAM policy ARN remain in lockstep.

**Tech Stack:** TypeScript, Pulumi AWS v7, Vitest 3, pnpm 11.

**Design spec:** [`docs/superpowers/specs/2026-07-20-aws-deployment-identity-design.md`](../specs/2026-07-20-aws-deployment-identity-design.md)

## Global Constraints

- `AWS_RESOURCE_PREFIX` is a non-secret, 1–29-character lowercase letter/number/hyphen identity; it must begin and end alphanumeric.
- When unset, the resolved identity must remain exactly `starter`.
- Legacy `AWS_STATE_RESOURCE_PREFIX` is a temporary alias; conflicting canonical and legacy values must fail before AWS or Pulumi runs.
- Use the identity for global, cross-account, public/exported, ECR-namespace, queue, and tag surfaces. Secrets and custom log groups stay environment-scoped (`/{environment}/…`).
- Queue physical names use `{prefix}-{queue}-{environment}` and DLQs use `{prefix}-{queue}-{environment}-dlq`.
- Concise secrets/logs (`/{environment}/…`) and tag shape (`Project` / `Environment` / `ManagedBy`) apply even when the identity defaults to `starter` (breaking rename of prior `/starter/…` and `starter-*-dlq-*` forms is accepted).
- Keep Pulumi project names, package names, source directories, stack names, logical Pulumi resource IDs, and database username/database name unchanged.
- Never inspect or commit local `.env` files; document variable names and examples only in `infra/.env.example`.
- Commit after each completed task (plan Steps labeled Commit).

---

## File Structure

- Create: `infra/aws/naming.ts` — identity resolution, validation, and naming helpers.
- Create: `infra/aws/naming.test.ts` — pure helper coverage for default, configured, legacy, and conflicting settings.
- Modify: `infra/aws/bootstrap/index.ts` — ECR namespace, global bootstrap names, tags, and policy ARNs.
- Modify: `infra/aws/bootstrap/bootstrap.mock.test.ts` — default compatibility and opt-in namespace assertions.
- Modify: `infra/aws/core/index.ts` — tags, global resource names, secret paths, and helper inputs.
- Modify: `infra/aws/core/queues.ts` — `{prefix}-{queue}-{env}[-dlq]` names plus project-aware tags.
- Modify: `infra/aws/core/manual-secrets.ts` — environment-secret paths (`/{env}/…`) plus project-aware tags.
- Modify: `infra/aws/core/pooler-stack.ts`, `infra/aws/core/pooler-tls.ts`, `infra/aws/core/pgbouncer.ts` — use canonical secret/log/global-name helpers.
- Modify: `infra/aws/core/*.mock.test.ts` — explicit default and configured-name assertions for affected modules.
- Modify: `infra/aws/apps/index.ts` — configured ECR namespace and canonical tags.
- Create: `infra/aws/apps/apps.mock.test.ts` and `infra/aws/apps/vitest.config.ts` — Pulumi mock coverage for image registry and tags.
- Modify: `infra/aws/apps/package.json` — add `test` and `test:watch` scripts.
- Modify: `infra/aws/scripts/state-orchestration.ts` and `.test.ts` — canonical state identity and matching deploy-role ARN.
- Modify: `infra/.env.example`, `infra/aws/GETTING_STARTED.md`, `infra/aws/README.md`, `.github/workflows/deploy-aws.yml` — canonical operator/CI configuration and migration guidance.

## Critical Tests

- `infra/aws/naming.test.ts`: default behavior is `starter`; configured `platform` produces canonical global names and `{prefix}-{queue}-{env}[-dlq]` queue names; invalid or conflicting settings throw; legacy-only settings return a warning.
- `infra/aws/scripts/state-orchestration.test.ts`: state bucket, audit bucket, stack name, and GitHub deployment-role ARN derive the same identity.
- `infra/aws/bootstrap/bootstrap.mock.test.ts`: configured identity produces `platform/dashboard` ECR repositories, identity-bearing public/cross-account resources, and matching IAM ARNs; default identity still resolves to `starter` names.
- `infra/aws/core/queues.mock.test.ts`: configured identity yields `platform-jobs-staging` and `platform-jobs-staging-dlq` with `Project=platform` tags.
- `infra/aws/core/manual-secrets.mock.test.ts`: secret path remains `/staging/stripe-secret-key` while Project tags use the configured identity.
- `infra/aws/apps/apps.mock.test.ts`: configured identity produces `123456789012.dkr.ecr.us-east-2.amazonaws.com/platform` and tags every app resource with `Project=platform`.

## Task 1: Add the canonical naming API

**Files:**
- Create: `infra/aws/naming.ts`
- Create: `infra/aws/naming.test.ts`

**Interfaces:**
- Consumes: `NodeJS.ProcessEnv` and an optional warning callback.
- Produces: `resolveDeploymentIdentity(env, warn): DeploymentIdentity`, `deploymentNames(identity, environment): DeploymentNames`.

- [x] **Step 1: Write failing identity-resolution tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { deploymentNames, resolveDeploymentIdentity } from "./naming";

describe("resolveDeploymentIdentity", () => {
  it("defaults to starter", () => {
    expect(resolveDeploymentIdentity({}).value).toBe("starter");
  });

  it("uses AWS_RESOURCE_PREFIX for global identity and prefixed queue names", () => {
    const identity = resolveDeploymentIdentity({ AWS_RESOURCE_PREFIX: "platform" });
    const names = deploymentNames(identity, "staging");
    expect(names.ecrNamespace).toBe("platform");
    expect(names.globalPrefix).toBe("platform-staging");
    expect(names.secretPathPrefix).toBe("/staging");
    expect(names.queueName("jobs")).toBe("platform-jobs-staging");
    expect(names.queueName("jobs", { dlq: true })).toBe("platform-jobs-staging-dlq");
  });

  it("warns for the legacy alias and rejects a conflict", () => {
    const warn = vi.fn();
    expect(resolveDeploymentIdentity({ AWS_STATE_RESOURCE_PREFIX: "platform" }, warn).value)
      .toBe("platform");
    expect(warn).toHaveBeenCalledOnce();
    expect(() => resolveDeploymentIdentity({
      AWS_RESOURCE_PREFIX: "platform",
      AWS_STATE_RESOURCE_PREFIX: "other",
    })).toThrow("must match");
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir infra/aws exec vitest run naming.test.ts`

Expected: FAIL because `infra/aws/naming.ts` does not exist.

- [x] **Step 3: Implement the pure naming module**

```ts
export type AwsEnvironment = "sandbox" | "staging" | "production";

export interface DeploymentIdentity { value: string; source: "canonical" | "legacy" | "default"; }

export function resolveDeploymentIdentity(
  env: NodeJS.ProcessEnv,
  warn: (message: string) => void = console.warn,
): DeploymentIdentity { /* validate canonical/legacy/default resolution */ }

export interface DeploymentNames {
  globalPrefix: string;
  ecrNamespace: string;
  secretPathPrefix: string;
  logGroupPrefix: string;
  tags: Record<string, string>;
  deployRoleName: string;
  queueName(name: string, options?: { dlq?: boolean }): string;
}

export function deploymentNames(identity: DeploymentIdentity, environment: AwsEnvironment): DeploymentNames {
  return {
    globalPrefix: `${identity.value}-${environment}`,
    ecrNamespace: identity.value,
    secretPathPrefix: `/${environment}`,
    logGroupPrefix: `/${environment}`,
    tags: { Project: identity.value, Environment: environment, ManagedBy: "pulumi" },
    deployRoleName: `${identity.value}-${environment}-github-deploy`,
    queueName: (name, options) =>
      `${identity.value}-${name}-${environment}${options?.dlq ? "-dlq" : ""}`,
  };
}
```

- [x] **Step 4: Run the naming tests**

Run: `pnpm --dir infra/aws exec vitest run naming.test.ts`

Expected: PASS.

- [x] **Step 5: Commit the naming API**

```bash
git add infra/aws/naming.ts infra/aws/naming.test.ts
git commit -m "feat(infra): add AWS deployment identity"
```

## Task 2: Apply identity to bootstrap and state bootstrap

**Files:**
- Modify: `infra/aws/bootstrap/index.ts`
- Modify: `infra/aws/bootstrap/bootstrap.mock.test.ts`
- Modify: `infra/aws/scripts/state-orchestration.ts`
- Modify: `infra/aws/scripts/state-orchestration.test.ts`

**Interfaces:**
- Consumes: `resolveDeploymentIdentity(process.env)` and `deploymentNames(identity, stack)`.
- Produces: ECR paths such as `platform/dashboard`, matching cross-account `deployRoleName`, and state names using the same identity.

- [ ] **Step 1: Add failing configured-identity tests**

Add a bootstrap mock case with `AWS_RESOURCE_PREFIX: "platform"` and assert:

```ts
expect(repositoryNames).toContain("platform/dashboard");
expect(policy).toContain("arn:aws:secretsmanager:us-east-2:*:secret:/staging/*");
expect(deployRole.inputs.name).toBe("platform-sandbox-github-deploy");
```

Add a state orchestration assertion:

```ts
expect(githubDeployRoleArn("111122223333", "staging", "platform"))
  .toBe("arn:aws:iam::111122223333:role/platform-staging-github-deploy");
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `pnpm --dir infra/aws/bootstrap test -- bootstrap.mock.test.ts && pnpm --dir infra/aws exec vitest run scripts/state-orchestration.test.ts`

Expected: FAIL because bootstrap and state bootstrap still hard-code `starter`.

- [ ] **Step 3: Route bootstrap and state bootstrap through naming helpers**

In `bootstrap/index.ts`, replace raw `starter` composition with the resolved
identity: use `names.globalPrefix` for public/cross-account resources,
`names.ecrNamespace` for repositories and the ECR output, and `names.tags` for
common tags. Keep the role's local function explicit but generate its name with
`names.deployRoleName`.

Change the state helper signature and its call sites to:

```ts
export function githubDeployRoleArn(
  workloadAccountId: string,
  environment: AwsEnvironment,
  resourcePrefix: string,
): string {
  return `arn:aws:iam::${workloadAccountId}:role/${resourcePrefix}-${environment}-github-deploy`;
}
```

Resolve the canonical identity in `resolveStateBootstrapConfig`; assign it to
the existing `resourcePrefix` field so buckets, aliases, stack names, tags, and
the cross-account role all share it.

- [ ] **Step 4: Run focused and regression tests**

Run: `pnpm --dir infra/aws/bootstrap test && pnpm --dir infra/aws exec vitest run scripts/state-orchestration.test.ts scripts/state-bootstrap.test.ts`

Expected: PASS, including unchanged default `starter` assertions.

- [ ] **Step 5: Commit bootstrap/state integration**

```bash
git add infra/aws/bootstrap infra/aws/scripts/state-orchestration.ts infra/aws/scripts/state-orchestration.test.ts
git commit -m "feat(infra): apply deployment identity to AWS bootstrap"
```

## Task 3: Apply identity to core and app stacks

**Files:**
- Modify: `infra/aws/core/index.ts`, `queues.ts`, `manual-secrets.ts`, `pgbouncer.ts`, `pooler-stack.ts`, `pooler-tls.ts`
- Modify: affected `infra/aws/core/*.mock.test.ts`
- Modify: `infra/aws/apps/index.ts`, `package.json`
- Create: `infra/aws/apps/apps.mock.test.ts`, `infra/aws/apps/vitest.config.ts`

**Interfaces:**
- Consumes: `DeploymentNames` from Task 1.
- Produces: prefixed queue names, environment-scoped secrets/log paths, canonical tags, and configured ECR registry namespace.

- [ ] **Step 1: Write failing core/app identity tests**

Add `platform` fixture assertions:

```ts
expect(queue.inputs.name).toBe("platform-jobs-staging");
expect(dlq.inputs.name).toBe("platform-jobs-staging-dlq");
expect(queue.inputs.tags).toMatchObject({ Project: "platform", Environment: "staging" });
expect(secret.inputs.name).toBe("/staging/stripe-secret-key");
expect(secret.inputs.tags).toMatchObject({ Project: "platform" });
expect(imageRegistry).toBe("123456789012.dkr.ecr.us-east-2.amazonaws.com/platform");
```

Use Pulumi mocks in `apps.mock.test.ts` to import `apps/index.ts`, record
resource inputs, and assert both an App Runner/Lambda tag and the ECR image URI.

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `pnpm --dir infra/aws/core test -- queues.mock.test.ts manual-secrets.mock.test.ts && pnpm --dir infra/aws/apps test`

Expected: FAIL because core/app stacks either retain `starter` names or the apps test command does not yet exist.

- [ ] **Step 3: Implement helper-based core/app naming**

Resolve identity once per stack after `pulumi.getStack()` and use
`deploymentNames(identity, stack)`. Replace `baseTags` with the helper tags plus
the appropriate `Layer` tag. Use `names.globalPrefix` for globally/exported
names, `names.secretPathPrefix` and `names.logGroupPrefix` for secrets/custom
logs, and `names.queueName("jobs")` / `names.queueName("jobs", { dlq: true })`
for SQS.

In `apps/index.ts`, construct the registry with `names.ecrNamespace`:

```ts
const imageRegistry = pulumi.interpolate`${registryAccountId}.dkr.ecr.${region}.amazonaws.com/${names.ecrNamespace}`;
```

Do not change the existing `starter-aws-core` StackReference or any database
connection username/database literal.

- [ ] **Step 4: Run all AWS stack tests**

Run: `pnpm --dir infra/aws/core test && pnpm --dir infra/aws/apps test && pnpm --dir infra/aws/bootstrap test`

Expected: PASS.

- [ ] **Step 5: Commit core/apps integration**

```bash
git add infra/aws/core infra/aws/apps
git commit -m "feat(infra): configure AWS workload resource identity"
```

## Task 4: Document and wire operator/CI configuration

**Files:**
- Modify: `infra/.env.example`
- Modify: `infra/aws/GETTING_STARTED.md`
- Modify: `infra/aws/README.md`
- Modify: `.github/workflows/deploy-aws.yml`

**Interfaces:**
- Consumes: `AWS_RESOURCE_PREFIX` as a non-secret local variable and GitHub Environment variable.
- Produces: CI commands and backend URLs that use the same resolved deployment identity as local state bootstrap.

- [ ] **Step 1: Add configuration examples and migration text**

Add this entry before state-account setup in `infra/.env.example`:

```dotenv
# AWS deployment identity. Set before the first AWS deployment; it controls
# state and selected workload names. Defaults to "starter" for compatibility.
# AWS_RESOURCE_PREFIX="my-product"
```

Document the exact precedence and immutable-name rule from the design spec.
Remove `AWS_STATE_RESOURCE_PREFIX` from the primary setup path; retain it in a
clearly labeled compatibility note only.

- [ ] **Step 2: Update GitHub Actions environment mapping**

Pass the non-secret GitHub Environment variable to every job that resolves
names or computes a backend URL:

```yaml
env:
  AWS_RESOURCE_PREFIX: ${{ vars.AWS_RESOURCE_PREFIX }}
```

Use that same variable in the `cloud-url` interpolation after the state helper
has standardized the bucket name. Do not log account IDs, domains, CIDRs, or
secret values.

- [ ] **Step 3: Verify documentation and workflow references**

Run: `rg -n 'AWS_STATE_RESOURCE_PREFIX|AWS_RESOURCE_PREFIX|starter/' infra/.env.example infra/aws .github/workflows/deploy-aws.yml`

Expected: `AWS_RESOURCE_PREFIX` is the new-user path; remaining `starter`
references are default-behavior examples, Pulumi project identifiers, or an
explicit compatibility explanation.

- [ ] **Step 4: Commit operator and CI docs**

```bash
git add infra/.env.example infra/aws/GETTING_STARTED.md infra/aws/README.md .github/workflows/deploy-aws.yml
git commit -m "docs(infra): document AWS deployment identity"
```

## Task 5: Verify the template contract

**Files:**
- Modify: `docs/superpowers/specs/2026-07-20-aws-deployment-identity-design.md` only if implementation changes a documented interface.

- [ ] **Step 1: Run formatting and static checks**

Run: `pnpm lint && pnpm type-check`

Expected: PASS.

- [ ] **Step 2: Run all targeted AWS tests**

Run: `pnpm --dir infra/aws/bootstrap test && pnpm --dir infra/aws/core test && pnpm --dir infra/aws/apps test && pnpm --dir infra/aws exec vitest run naming.test.ts scripts/state-orchestration.test.ts scripts/state-bootstrap.test.ts`

Expected: PASS with default and configured identity coverage.

- [ ] **Step 3: Inspect the final diff for prohibited churn**

Run: `git diff main...HEAD -- infra/aws .github/workflows/deploy-aws.yml infra/.env.example docs/superpowers`

Expected: no Pulumi project-name, package-name, directory-layout, stack-name, or database-credential rename.

## Plan Self-Review

Spec coverage: Tasks 1–3 implement the configuration, selective naming, IAM invariant, and compatibility contract. Task 2 covers coupled state/workload identity. Task 4 covers downstream adoption. Task 5 verifies default compatibility and rejects prohibited churn.

Placeholder scan: The plan contains no deferred implementation language; all tasks name concrete files, interfaces, commands, and expected results.

Type consistency: `DeploymentIdentity`, `DeploymentNames`, `resolveDeploymentIdentity`, and `deploymentNames` are defined in Task 1 and reused with those exact names in Tasks 2–3.
