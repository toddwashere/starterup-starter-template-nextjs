# Central AWS Pulumi State Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an idempotent, operator-driven workflow that provisions encrypted Pulumi state foundations in a dedicated AWS account and connects selected workload environments without initializing or deploying their Pulumi layers.

**Architecture:** A TypeScript CLI validates the state and workload AWS profiles, derives deterministic per-environment names, and deploys a retained CloudFormation stack into the dedicated state account. The stack owns a private versioned state bucket, KMS key, audit-log bucket, and CloudTrail data-event trail; resource policies grant only the selected workload account's SSO administrator role and deterministic GitHub deploy role access. The CLI then verifies workload-account access, logs Pulumi into the S3 backend, and prints explicit layer initialization/deployment commands.

**Tech Stack:** TypeScript, AWS CLI v2, CloudFormation YAML, Pulumi CLI DIY S3 backend, Vitest.

---

## File Structure

- Create `infra/aws/state-bootstrap/pulumi-state.cfn.yaml`: retained S3/KMS/CloudTrail foundation for one environment.
- Create `infra/aws/scripts/state-orchestration.ts`: pure argument parsing, validation, naming, retention, principal, backend, and next-command helpers.
- Create `infra/aws/scripts/state-orchestration.test.ts`: colocated unit tests for all safety-critical pure behavior.
- Create `infra/aws/scripts/state-bootstrap.ts`: side-effecting AWS/CloudFormation/Pulumi command orchestration.
- Modify `package.json` and `scripts/vitest.config.ts`: expose the command and discover its tests.
- Modify `infra/.env.example`: document required state account/profile/resource-prefix variables.
- Modify `infra/aws/bootstrap/index.ts` and `infra/aws/bootstrap/bootstrap.mock.test.ts`: grant the workload GitHub role least-privilege access to its central state bucket and KMS key.
- Modify `.github/workflows/deploy-aws.yml`: use the S3 backend and KMS provider instead of a Pulumi Cloud token.
- Modify `infra/aws/GETTING_STARTED.md`, `infra/aws/README.md`, and `infra/vercel/README.md`: document the central backend and explicit per-environment follow-up commands.

## Critical Tests

- `infra/aws/scripts/state-orchestration.test.ts`: rejects missing/invalid required prefixes, account IDs, profiles, and environments; CLI overrides environment defaults; derives globally unique per-environment bucket/KMS/stack names; derives the SSO IAM role from an STS assumed-role ARN; emits 90/365-day state-version retention and 90/2190-day audit retention; builds a profile-pinned state-account command environment; prints commands without initializing Pulumi stacks.
- `infra/aws/bootstrap/bootstrap.mock.test.ts`: GitHub deploy role receives only the selected environment's central bucket/object actions and KMS cryptographic actions, with no wildcard state resources.
- `infra/aws/scripts/state-bootstrap.test.ts`: both account identities are checked before mutation, access probes use the workload profile, and no Pulumi layer command executes.
- `scripts/infra-init-next-steps.test.ts`: AWS next-step guidance points operators to the central state bootstrap before any layer initialization.

## Task 1: Pure orchestration contract

**Files:**

- Create: `infra/aws/scripts/state-orchestration.test.ts`
- Create: `infra/aws/scripts/state-orchestration.ts`
- Modify: `scripts/vitest.config.ts`

- [x] **Step 1:** Write failing tests for parsing `init <environment>`, required `AWS_STATE_RESOURCE_PREFIX`, state/workload account validation, CLI override precedence, deterministic names, retention tiers, SSO role ARN normalization, backend URL construction, and printed next commands.
- [x] **Step 2:** Run `pnpm exec vitest run --config scripts/vitest.config.ts infra/aws/scripts/state-orchestration.test.ts` and verify failures are caused by the missing implementation.
- [x] **Step 3:** Implement the minimal pure helpers and types needed by the tests.
- [x] **Step 4:** Re-run the focused test and confirm it passes.

## Task 2: Retained CloudFormation foundation

**Files:**

- Create: `infra/aws/state-bootstrap/pulumi-state.cfn.yaml`
- Modify: `infra/aws/scripts/state-orchestration.test.ts`

- [x] **Step 1:** Add template-shape tests that load the YAML as text and prove every state resource has retain/update-retain policies, bucket public access is blocked, versioning and KMS encryption are enabled, TLS is enforced, KMS rotation is enabled, and CloudTrail data events target only the environment state bucket.
- [x] **Step 2:** Run the focused test and verify it fails because the template is missing.
- [x] **Step 3:** Add the parameterized template with state bucket, environment KMS key, audit bucket, CloudTrail trail, tiered lifecycle rules, and direct cross-account policies for the discovered SSO role and deterministic GitHub role.
- [x] **Step 4:** Re-run the focused test and validate the template with `aws cloudformation validate-template --profile starter-state --template-body file://infra/aws/state-bootstrap/pulumi-state.cfn.yaml`.

## Task 3: Idempotent state bootstrap CLI

**Files:**

- Create: `infra/aws/scripts/state-bootstrap.ts`
- Modify: `package.json`
- Modify: `infra/.env.example`

- [x] **Step 1:** Add command-planning tests proving no mutating command is planned until both STS identities match configured account IDs, CloudFormation deploy uses the state profile, access verification and Pulumi login use the workload profile, and no `pulumi stack init/up` command is executed.
- [x] **Step 2:** Run the focused test and verify expected failures.
- [x] **Step 3:** Implement `pnpm infra:aws:state init <environment>` with `--state-profile`, `--workload-profile`, `--state-account-id`, and `--resource-prefix` overrides; environment values are defaults and CLI flags take precedence.
- [x] **Step 4:** Add `AWS_STATE_ACCOUNT_ID`, `AWS_STATE_PROFILE`, and required `AWS_STATE_RESOURCE_PREFIX` examples without adding real deployment identifiers.
- [x] **Step 5:** Re-run tests and perform a non-mutating `--help` smoke test.

## Task 4: Workload CI access

**Files:**

- Modify: `infra/aws/bootstrap/bootstrap.mock.test.ts`
- Modify: `infra/aws/bootstrap/index.ts`
- Modify: `.github/workflows/deploy-aws.yml`

- [x] **Step 1:** Add a failing Pulumi mock assertion for scoped S3 and KMS state permissions on `starter-<env>-github-deploy`.
- [x] **Step 2:** Run the bootstrap mock test and verify it fails for the missing inline policy.
- [x] **Step 3:** Add the minimal inline policy derived from state-account ID, required resource prefix, environment, and region.
- [x] **Step 4:** Replace Pulumi Cloud token usage in CI with an explicit S3 backend login and `PULUMI_ORG=organization`; keep application deployment credentials scoped to the workload account.
- [x] **Step 5:** Re-run bootstrap tests and validate the workflow syntax.

## Task 5: Operator documentation

**Files:**

- Modify: `infra/aws/GETTING_STARTED.md`
- Modify: `infra/aws/README.md`
- Create: `scripts/infra-init-next-steps.test.ts`
- Create: `scripts/infra-init-next-steps.ts`
- Modify: `scripts/infra-init.ts`

- [x] **Step 1:** Add/update a failing next-step assertion that points AWS operators to `infra:aws:state`.
- [x] **Step 2:** Update the runbook with state-account creation, profile verification, required environment variables, one state-init command per environment, KMS-backed `stack init` commands, preview/up order, and teardown behavior.
- [x] **Step 3:** Explicitly document that the script never initializes or deploys bootstrap/core/apps and that state/audit resources survive application teardown.
- [x] **Step 4:** Re-run script tests.

## Task 6: Verification

- [x] Run `pnpm test:scripts`.
- [x] Run focused AWS bootstrap/core tests.
- [x] Run `pnpm type-check`.
- [x] Run `pnpm lint`.
- [x] Run `git diff --check` and confirm active AWS documentation/config contains no Pulumi Cloud dependency.
- [x] Confirm no secret files or real credential values were read or committed.
