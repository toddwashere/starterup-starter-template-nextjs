# Vercel + AWS Hybrid Data/AI Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing AWS data plane consumable from Vercel-hosted apps without Secure Compute: keyless IAM access via Vercel OIDC, a public PgBouncer pooler in front of private RDS, Amazon Bedrock support, all HIPAA-logged.

**Architecture:** Vercel calls S3/SQS/Bedrock/Secrets over public AWS APIs using short-lived credentials from an assumed IAM role (Vercel OIDC federation). Postgres pooling for Vercel goes through a public NLB → in-VPC PgBouncer (Fargate, transaction mode) → private RDS; RDS and RDS Proxy stay private. `complianceMode: "hipaa"` drives audit/logging.

**Tech Stack:** Pulumi (`@pulumi/aws`), ECS Fargate + NLB (PgBouncer), Vercel AI SDK (`@ai-sdk/amazon-bedrock`), `@vercel/functions/oidc`, Vitest.

**Design spec:** [`docs/superpowers/specs/2026-07-10-vercel-aws-hybrid-data-ai-plane-design.md`](../specs/2026-07-10-vercel-aws-hybrid-data-ai-plane-design.md)

## Global Constraints

- ESM only; never `require()`/`module.exports`.
- No Vercel Secure Compute / VPC peering. Vercel reaches AWS via public endpoints + IAM.
- RDS and RDS Proxy remain private (`publiclyAccessible: false` unchanged). PgBouncer is the only public DB surface.
- Reuse `infra/shared/compliance.ts`; do not add a new compliance abstraction.
- Public DB endpoint (PgBouncer) in **all** environments.
- Vercel→AWS auth is **OIDC-assumed role only** — no long-lived access keys in Vercel env.
- Colocated `*.test.ts`; no `__tests__/`. Never read local secret files; update `.env.example`.
- Keep the non-prod data-safety gating already in `core`.

---

## File Structure

- Modify: `packages/ai/src/platform/get-model.ts` — add `bedrock` provider case.
- Modify: `packages/ai/src/platform/models/ai-models-available.ts` — Bedrock catalog entries.
- Modify: `packages/ai/keys.ts` + `packages/ai/src/keys.test.ts` — `AWS_REGION`, `AWS_ROLE_ARN`.
- Modify: `packages/ai/package.json` — add `@ai-sdk/amazon-bedrock`, `@vercel/functions`.
- Modify: `infra/shared/aws-env-config.ts` + `aws-env-config.test.ts` — pooler/ai/access config.
- Modify: `infra/aws/config.common.ts`, `config.sandbox.ts`, `config.staging.ts`, `config.production.ts`.
- Create: `infra/aws/core/vercel-access.ts` + `vercel-access.mock.test.ts` — OIDC provider + role.
- Create: `infra/aws/core/pgbouncer.ts` + `pgbouncer.mock.test.ts` — NLB + Fargate PgBouncer.
- Modify: `infra/aws/core/index.ts` — wire the two new modules, Bedrock IAM, exports.
- Modify: `.env.example` — Vercel-side vars (`AWS_ROLE_ARN`, `AWS_REGION`, `DATABASE_URL` pooled).
- Modify: `infra/aws/README.md`, `infra/vercel/README.md` — hybrid wiring + OIDC setup.

## Critical Tests

- `packages/ai/src/platform/get-model.test.ts`: `bedrock:<model>` builds a Bedrock `LanguageModel`; missing `AWS_REGION` throws; unknown model id rejected.
- `packages/ai/src/platform/models/ai-models-available.test.ts`: Bedrock entries parse and list.
- `infra/shared/aws-env-config.test.ts`: `database.pooler.enabled` true in all envs; `access.vercelOidc` + `ai.bedrockModels` resolve.
- `infra/aws/core/vercel-access.mock.test.ts`: role policy is least-privilege (S3 uploads / SQS jobs / Secrets app / Bedrock models only); trust policy scoped to the Vercel `sub` claim, no wildcard principal.
- `infra/aws/core/pgbouncer.mock.test.ts`: PgBouncer service in private subnets; NLB public on 6432; `db-sg` allows PgBouncer→RDS 5432; RDS `publiclyAccessible` stays false.

---

## Task 1: Bedrock provider in the AI package

**Files:**
- Modify: `packages/ai/keys.ts`
- Test: `packages/ai/src/keys.test.ts`
- Modify: `packages/ai/src/platform/get-model.ts`
- Test: `packages/ai/src/platform/get-model.test.ts`
- Modify: `packages/ai/src/platform/models/ai-models-available.ts`
- Modify: `packages/ai/package.json`

**Interfaces:**
- Consumes: `createAmazonBedrock` from `@ai-sdk/amazon-bedrock`; `awsCredentialsProvider` from `@vercel/functions/oidc`; `keys()` from `../../keys`.
- Produces: `getModel({ providerModel: "bedrock:<id>" })` returns a `LanguageModel`.

- [ ] **Step 1: Add deps**

Run: `pnpm --filter @workspace/ai add @ai-sdk/amazon-bedrock @vercel/functions`

- [ ] **Step 2: Add keys + failing keys test**

Add to `packages/ai/keys.ts` schema and `keys()` return:

```ts
  // Amazon Bedrock (IAM-based; no API key)
  AWS_REGION: optionalString,
  AWS_ROLE_ARN: optionalString, // set on Vercel for OIDC-assumed access
```

Add to `packages/ai/src/keys.test.ts`:

```ts
it("reads Bedrock region and role arn when set", () => {
  vi.stubEnv("AWS_REGION", "us-east-1");
  vi.stubEnv("AWS_ROLE_ARN", "arn:aws:iam::123:role/vercel");
  const k = keys();
  expect(k.AWS_REGION).toBe("us-east-1");
  expect(k.AWS_ROLE_ARN).toBe("arn:aws:iam::123:role/vercel");
});
```

- [ ] **Step 3: Run test, verify fail → implement → pass**

Run: `pnpm --filter @workspace/ai test -- keys`
Expected: FAIL, then PASS after adding the two keys.

- [ ] **Step 4: Write failing get-model test**

Add to `packages/ai/src/platform/get-model.test.ts`:

```ts
it("builds a Bedrock model when AWS_REGION is set", () => {
  vi.stubEnv("AWS_REGION", "us-east-1");
  const model = getModel({ providerModel: "bedrock:anthropic.claude-3-5-sonnet-20240620-v1:0" });
  expect(model).toBeDefined();
});

it("throws when Bedrock is selected without AWS_REGION", () => {
  vi.stubEnv("AWS_REGION", "");
  expect(() =>
    getModel({ providerModel: "bedrock:anthropic.claude-3-5-sonnet-20240620-v1:0" }),
  ).toThrow(/AWS_REGION/);
});
```

- [ ] **Step 5: Run test, verify fail**

Run: `pnpm --filter @workspace/ai test -- get-model`
Expected: FAIL — no `bedrock` case.

- [ ] **Step 6: Implement the bedrock case**

Add the import and a `case "bedrock"` to `packages/ai/src/platform/get-model.ts`:

```ts
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { awsCredentialsProvider } from "@vercel/functions/oidc";
```

```ts
    case "bedrock": {
      if (!config.AWS_REGION) {
        throw new Error("AI provider 'bedrock' requires AWS_REGION to be set");
      }
      // On Vercel, AWS_ROLE_ARN drives OIDC-assumed credentials; in AWS
      // (Lambda/App Runner) the default credential chain (task role) is used.
      const bedrock = createAmazonBedrock({
        region: config.AWS_REGION,
        ...(config.AWS_ROLE_ARN
          ? { credentialProvider: awsCredentialsProvider({ roleArn: config.AWS_ROLE_ARN }) }
          : {}),
      });
      return bedrock(modelId);
    }
```

Add `"bedrock"` to the provider union that `parseProviderModelValue` accepts (in `ai-models-available.ts`) and add at least one catalog entry, e.g. `bedrock:anthropic.claude-3-5-sonnet-20240620-v1:0`.

- [ ] **Step 7: Run tests, verify pass**

Run: `pnpm --filter @workspace/ai test`
Expected: PASS. Add a catalog parse test in `ai-models-available.test.ts` for the bedrock entry.

- [ ] **Step 8: Commit**

```bash
git add packages/ai .env.example
git commit -m "feat(ai): add Amazon Bedrock provider (IAM/OIDC credentials)"
```

---

## Task 2: AWS env config — pooler, AI, and Vercel-access flags

**Files:**
- Modify: `infra/shared/aws-env-config.ts`
- Test: `infra/shared/aws-env-config.test.ts`
- Modify: `infra/aws/config.common.ts` (+ sandbox/staging/production)

**Interfaces:**
- Produces: `AwsEnvConfig.database.pooler`, `.ai`, `.access` resolving per env.

- [ ] **Step 1: Extend the type + failing test**

Add to `AwsEnvConfig` in `infra/shared/aws-env-config.ts`:

```ts
export interface AwsPoolerConfig { enabled: boolean; publicListener: boolean; poolSize: number; }
export interface AwsAiConfig { bedrockRegion: string; bedrockModels: string[]; }
export interface AwsAccessConfig { vercelOidc: { teamSlug: string; projectName: string } }
```

and reference them on `AwsDatabaseConfig` (`pooler: AwsPoolerConfig`) and `AwsEnvConfig` (`ai: AwsAiConfig; access: AwsAccessConfig`). Add a test asserting all three envs resolve `database.pooler.enabled === true` and a non-empty `ai.bedrockModels`.

- [ ] **Step 2: Run test → fail → set base config → pass**

In `config.common.ts` add to `envBaseConfig`:

```ts
  database: {
    instanceClass: "db.t4g.micro", allocatedStorage: 20, multiAz: false, engineVersion: "16",
    pooler: { enabled: true, publicListener: true, poolSize: 25 },
  },
  ai: { bedrockRegion: "us-east-1", bedrockModels: ["anthropic.claude-3-5-sonnet-20240620-v1:0"] },
  access: { vercelOidc: { teamSlug: "", projectName: "" } },
```

Run: `pnpm --filter ./infra/... test -- aws-env-config` → PASS.

- [ ] **Step 3: Commit**

```bash
git add infra/shared/aws-env-config.ts infra/shared/aws-env-config.test.ts infra/aws/config.*.ts
git commit -m "feat(infra): add pooler/ai/vercel-access config to AWS env schema"
```

---

## Task 3: Vercel OIDC provider + least-privilege IAM role

**Files:**
- Create: `infra/aws/core/vercel-access.ts`
- Test: `infra/aws/core/vercel-access.mock.test.ts`
- Modify: `infra/aws/core/index.ts` (call it, export `vercelRoleArn`)

**Interfaces:**
- Consumes: uploads bucket ARN, jobs queue ARN, secret ARNs, `ai.bedrockModels`, `access.vercelOidc`.
- Produces: `buildVercelAccess(args): { roleArn: pulumi.Output<string> }`.

- [ ] **Step 1: Write failing mock test**

`infra/aws/core/vercel-access.mock.test.ts` (model on existing `*.mock.test.ts`): assert the created `aws:iam/role:Role` trust policy references `oidc.vercel.com/<team>` and conditions on the `sub` claim; the attached policy statements cover S3 uploads, SQS SendMessage, Secrets GetSecretValue, and `bedrock:InvokeModel*` on the model ARNs — and contain **no** `"Resource": "*"` on S3/SQS/Secrets.

- [ ] **Step 2: Run test → fail**

Run: `pnpm --filter ./infra/... test -- vercel-access`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `infra/aws/core/vercel-access.ts` exporting `buildVercelAccess`:
- `aws.iam.OpenIdConnectProvider` for `https://oidc.vercel.com/<teamSlug>` (audience `https://vercel.com/<teamSlug>`).
- `aws.iam.Role` with a trust policy: `Federated` = the OIDC provider ARN, `Condition.StringEquals` on `oidc.vercel.com/<team>:aud` and `StringLike` on `:sub` = `owner:<team>:project:<project>:environment:*`.
- `aws.iam.RolePolicy` with the scoped statements (S3 uploads objects+bucket, SQS SendMessage on the jobs ARN, Secrets GetSecretValue on the app secret ARNs, `bedrock:InvokeModel`/`InvokeModelWithResponseStream` on `arn:aws:bedrock:<region>::foundation-model/<id>` for each configured model, and the CMEK decrypt statement when `cmek`).
- Return `{ roleArn: role.arn }`.

- [ ] **Step 4: Wire + run tests + pass**

In `core/index.ts`, call `buildVercelAccess({...})` after the bucket/queue/secrets exist and `export const vercelRoleArn = ...`. Run the test → PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/aws/core/vercel-access.ts infra/aws/core/vercel-access.mock.test.ts infra/aws/core/index.ts
git commit -m "feat(infra): Vercel OIDC provider + least-privilege access role"
```

---

## Task 4: Public PgBouncer pooler (NLB + Fargate) in front of private RDS

**Files:**
- Create: `infra/aws/core/pgbouncer.ts`
- Test: `infra/aws/core/pgbouncer.mock.test.ts`
- Modify: `infra/aws/core/index.ts` (call it; add public `DATABASE_URL` secret for Vercel)

**Interfaces:**
- Consumes: `vpc`, `publicSubnets`, `privateSubnets`, `appSg`/`dbSg`, RDS endpoint, DB credentials secret, `database.pooler`.
- Produces: `{ poolerEndpoint: pulumi.Output<string> }` (NLB DNS:6432).

- [ ] **Step 1: Write failing mock test**

`infra/aws/core/pgbouncer.mock.test.ts`: assert an `aws:ecs/service:Service` with `networkConfiguration` on the **private** subnets; an `aws:lb/loadBalancer:LoadBalancer` of type `network` in **public** subnets with a listener on **6432**; a `db-sg` rule allowing 5432 from the PgBouncer SG; and that no resource sets RDS `publiclyAccessible: true`.

- [ ] **Step 2: Run test → fail**

Run: `pnpm --filter ./infra/... test -- pgbouncer`

- [ ] **Step 3: Implement**

Create `infra/aws/core/pgbouncer.ts` exporting `buildPgBouncer`, guarded by `pooler.enabled`:
- ECS cluster (or reuse), a Fargate `TaskDefinition` running a PgBouncer image (e.g. `edoburu/pgbouncer`) with env: `DATABASES_HOST`=RDS endpoint, `POOL_MODE=transaction`, `DEFAULT_POOL_SIZE=poolSize`, `CLIENT_TLS_SSLMODE=require`, `SERVER_TLS_SSLMODE=require`; secrets from Secrets Manager (DB user/pass).
- `aws.ecs.Service` `desiredCount: 2`, private subnets, its own SG (`pgbouncer-sg`).
- `aws.lb.LoadBalancer` type `network`, public subnets, `aws.lb.Listener` port 6432 → target group → the service.
- SG rules: `pgbouncer-sg` egress 5432 to `db-sg`; add `db-sg` ingress 5432 from `pgbouncer-sg`; NLB listener 6432 open to `0.0.0.0/0`.
- Return the NLB DNS name.

Then in `core/index.ts`, add a Vercel-facing pooled secret:

```ts
const vercelDbUrl = pulumi.interpolate`postgresql://starter:${dbPassword.result}@${poolerEndpoint}:6432/starter?sslmode=verify-full`;
```

stored as a Secrets Manager entry (or surfaced as a stack output for pasting into Vercel).

- [ ] **Step 4: Run tests + pass; preview compiles**

Run: `pnpm --filter ./infra/... test -- pgbouncer` → PASS. Then `cd infra/aws/core && pulumi preview -s sandbox` shows NLB + ECS + SG rules and RDS still private.

- [ ] **Step 5: Commit**

```bash
git add infra/aws/core/pgbouncer.ts infra/aws/core/pgbouncer.mock.test.ts infra/aws/core/index.ts
git commit -m "feat(infra): public PgBouncer pooler (NLB+Fargate) fronting private RDS"
```

---

## Task 5: Bedrock IAM + compliance logging

**Files:**
- Modify: `infra/aws/core/index.ts` (Bedrock perms on in-AWS roles; Bedrock invocation logging)
- Modify: `infra/aws/apps/index.ts` (add `bedrock:InvokeModel*` to instance + workers roles if AI runs server-side there)
- Modify: `infra/aws/config.production.ts` / `config.staging.ts` — `complianceMode: "hipaa"` where PHI applies

- [ ] **Step 1: Grant Bedrock to in-AWS roles**

Add `bedrock:InvokeModel` + `bedrock:InvokeModelWithResponseStream` (scoped to `ai.bedrockModels` ARNs) to the App Runner instance role and the workers Lambda role in `apps/index.ts`.

- [ ] **Step 2: Enable Bedrock model invocation logging**

In `core`, when `compliance.auditLogs`, configure Bedrock model-invocation logging to the CloudTrail/CloudWatch/S3 log sink.

- [ ] **Step 3: Set complianceMode**

Set `complianceMode: "hipaa"` on the PHI environments (per decision, keep all envs' public pooler; compliance features layer on top).

- [ ] **Step 4: Type-check + commit**

```bash
pnpm type-check
git add infra/aws/apps/index.ts infra/aws/core/index.ts infra/aws/config.*.ts
git commit -m "feat(infra): Bedrock IAM + invocation logging under HIPAA compliance"
```

---

## Task 6: Vercel-side wiring + app credential providers

**Files:**
- Modify: `.env.example`
- Modify: app data-access for S3/SQS to use `awsCredentialsProvider` when `AWS_ROLE_ARN` is set
- Modify: `infra/vercel/README.md`, `infra/aws/README.md`

- [ ] **Step 1: Env template**

Add to `.env.example` (Vercel side): `AWS_ROLE_ARN`, `AWS_REGION`, and `DATABASE_URL` pointed at the PgBouncer endpoint (`:6432?sslmode=verify-full`). Note these come from `core` stack outputs.

- [ ] **Step 2: SDK clients use OIDC creds**

Where S3/SQS clients are constructed for runtime, pass `credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN })` when `AWS_ROLE_ARN` is set (Vercel); otherwise default chain (AWS). Mirror the Bedrock pattern from Task 1.

- [ ] **Step 3: Docs**

Document in `infra/vercel/README.md`: create the Vercel OIDC provider values, set `AWS_ROLE_ARN`/`AWS_REGION`/`DATABASE_URL` in the Vercel project, and the assume-role smoke test. Update `infra/aws/README.md` with the hybrid topology + PgBouncer + Vercel role outputs.

- [ ] **Step 4: Commit**

```bash
git add .env.example infra/vercel/README.md infra/aws/README.md apps packages
git commit -m "docs(infra): document Vercel<->AWS hybrid wiring (OIDC, PgBouncer, Bedrock)"
```

---

## Self-Review Notes

- Spec coverage: OIDC access (T3), PgBouncer public pooling (T4), Bedrock provider (T1) + IAM/logging (T5), config surface (T2), Vercel wiring (T6), HIPAA logging (T5). All spec sections covered.
- RDS stays private in every task; PgBouncer is the only public DB surface — matches spec.
- No long-lived keys: OIDC everywhere (T1 Bedrock, T3 role, T6 clients).
- Placeholder scan: PgBouncer/vercel-access tasks name exact resources + key props; expand to literal Pulumi blocks during execution.

## Verification (end of plan)

- `pnpm type-check`
- `pnpm lint`
- `pnpm --filter @workspace/ai test`
- `pnpm --filter ./infra/... test`
- `cd infra/aws/core && pulumi preview -s sandbox` (NLB + PgBouncer + Vercel role + Bedrock IAM; RDS private)
- Manual from a Vercel preview: assume-role → S3 `PutObject`, SQS `SendMessage`, Bedrock `InvokeModel`, pooled query via PgBouncer.
