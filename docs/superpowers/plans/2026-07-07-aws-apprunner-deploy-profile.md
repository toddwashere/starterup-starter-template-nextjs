# AWS App Runner Deploy Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve `infra/aws` from ECS Fargate to a compliance-aware, single-topology profile: App Runner for the 4 web apps, SQS-triggered Lambda for workers, RDS + RDS Proxy, all private VPC, `complianceMode`-gated features.

**Architecture:** A typed env-config (`infra/shared/aws-env-config.ts`) mirrors the GCP pattern. `core` owns VPC, RDS, RDS Proxy, SQS, S3, Secrets, and compliance resources; `apps` owns 4 App Runner services + the workers Lambda + SQS event source mapping + EventBridge schedules. App code changes are additive (new Lambda entrypoint; pooled/direct DB URL split) and must not break other cloud profiles.

**Tech Stack:** Pulumi (`@pulumi/aws`, `@pulumi/random`), `@prisma/adapter-pg`, `@aws-sdk/client-sqs`, `aws-lambda` types, Vitest.

**Design spec:** [`docs/superpowers/specs/2026-07-07-aws-apprunner-deploy-profile-design.md`](../specs/2026-07-07-aws-apprunner-deploy-profile-design.md)

## Global Constraints

- ESM only; never `require()`/`module.exports`.
- Reuse `infra/shared/compliance.ts` `resolveCompliance(mode)` — do not add a new compliance abstraction.
- Single network topology in all envs (private RDS, RDS Proxy in-VPC, App Runner VPC connector, Lambda in-VPC, NAT); `complianceMode` toggles only features (CMEK, CloudTrail, Object-Lock logs, WAF, interface VPC endpoints, Multi-AZ, per-AZ HA NAT).
- Do NOT delete the BullMQ drain route, Redis support, or the workers poller — other profiles (Vercel/Render/GCP) rely on them. The Lambda entrypoint is additive.
- Colocated `*.test.ts` beside implementation; no `__tests__/`.
- Never read local secret files; `.env.example` is the only env reference. Add new vars there.
- Migrations run against `DIRECT_URL`; runtime uses pooled `DATABASE_URL`.
- Envs: `sandbox`, `staging`, `production`.

---

## File Structure

- Modify: `packages/database/keys.ts` — add optional `DIRECT_URL` (falls back to `DATABASE_URL`).
- Modify: `packages/database/keys.test.ts` — cover the fallback.
- Modify: `packages/database/src/client.ts` — cap pg pool `max`.
- Modify: `packages/database/prisma.config.ts` — migrations use `DIRECT_URL`.
- Modify: `.env.example` — document `DIRECT_URL`.
- Create: `apps/workers/src/lambda.ts` — SQS batch handler (additive entrypoint).
- Create: `apps/workers/src/lambda.test.ts` — batch dispatch + partial failure + poison.
- Modify: `apps/workers/package.json` — add `aws-lambda` dev types.
- Create: `infra/shared/aws-env-config.ts` — typed AWS env config + compose/validate/fan-out.
- Create: `infra/shared/aws-env-config.test.ts` — resolution + validation tests.
- Create: `infra/aws/config.common.ts`, `config.sandbox.ts`, `config.staging.ts`, `config.production.ts`.
- Create: `infra/aws/compliance-resources.ts` — maps `ComplianceConfig` to AWS resources.
- Create: `infra/aws/compliance-resources.test.ts` — mock: none=noop, hipaa=features.
- Modify: `infra/aws/core/index.ts` — VPC, RDS (private), RDS Proxy, SQS, S3, Secrets, compliance.
- Rewrite: `infra/aws/apps/index.ts` — App Runner ×4 + workers Lambda + event source mapping + EventBridge.
- Modify: `.github/workflows/deploy-aws.yml` — migrate gate → App Runner update → Lambda publish.
- Modify: `infra/aws/README.md` — new architecture + cost + setup.

## Critical Tests

- `apps/workers/src/lambda.test.ts`: dispatches each SQS record to the correct handler via `getHandler`; one handler throw adds only that `messageId` to `batchItemFailures` (others ack); invalid-JSON body is reported as a failure (→ DLQ), not silently dropped.
- `packages/database/keys.test.ts`: `DATABASE_URL` required; `DIRECT_URL` optional and falls back to `DATABASE_URL`; invalid URLs rejected.
- `infra/shared/aws-env-config.test.ts`: `composeEnvConfig` merges common→env→overrides; `complianceMode` and sizing resolve per env; validation flags missing region/account.
- `infra/aws/compliance-resources.test.ts`: `mode:"none"` registers zero compliance resources while base networking exists; `hipaa` enables CMEK KMS key, CloudTrail data-event trail, Object-Lock log bucket with `logRetentionDays`, WAF, and interface VPC endpoints.

---

## Task 1: Pooled/direct DATABASE_URL split (cross-cutting)

**Files:**
- Modify: `packages/database/keys.ts`
- Test: `packages/database/keys.test.ts`
- Modify: `packages/database/src/client.ts`
- Modify: `packages/database/prisma.config.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `keys()` returns `{ DATABASE_URL: string; DIRECT_URL: string }` where `DIRECT_URL` defaults to `DATABASE_URL` when unset.

- [ ] **Step 1: Write failing test**

In `packages/database/keys.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { keys } from "./keys";

const OLD = process.env;
afterEach(() => { process.env = { ...OLD }; });

describe("database keys", () => {
  it("defaults DIRECT_URL to DATABASE_URL when unset", () => {
    process.env.DATABASE_URL = "postgresql://u:p@host:6543/db";
    delete process.env.DIRECT_URL;
    const k = keys();
    expect(k.DIRECT_URL).toBe("postgresql://u:p@host:6543/db");
  });

  it("uses DIRECT_URL when provided", () => {
    process.env.DATABASE_URL = "postgresql://u:p@pooler:6543/db";
    process.env.DIRECT_URL = "postgresql://u:p@direct:5432/db";
    const k = keys();
    expect(k.DIRECT_URL).toBe("postgresql://u:p@direct:5432/db");
  });

  it("rejects a missing DATABASE_URL", () => {
    delete process.env.DATABASE_URL;
    expect(() => keys()).toThrow();
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `pnpm --filter @workspace/database test -- keys`
Expected: FAIL — `DIRECT_URL` not in schema.

- [ ] **Step 3: Implement the split**

Replace `packages/database/keys.ts`:

```ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z
    .string({ required_error: "DATABASE_URL is required" })
    .url("DATABASE_URL must be a valid URL"),
  DIRECT_URL: z.string().url("DIRECT_URL must be a valid URL").optional(),
});

export function keys() {
  const parsed = schema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
  });
  return {
    DATABASE_URL: parsed.DATABASE_URL,
    DIRECT_URL: parsed.DIRECT_URL ?? parsed.DATABASE_URL,
  };
}
```

- [ ] **Step 4: Cap the pg pool in the client**

In `packages/database/src/client.ts`, bound connections per process:

```ts
function createPrismaClient(): PrismaClient {
  const { DATABASE_URL } = keys();
  const max = Number(process.env.DATABASE_POOL_MAX ?? "5");
  const adapter = new PrismaPg({ connectionString: DATABASE_URL, max });
  return new PrismaClient({ adapter });
}
```

- [ ] **Step 5: Point migrations at DIRECT_URL**

In `packages/database/prisma.config.ts`, change the datasource url:

```ts
  datasource: {
    url: env("DIRECT_URL") ?? env("DATABASE_URL"),
  },
```

(If `prisma/config`'s `env()` doesn't support `??`, read `process.env.DIRECT_URL ?? process.env.DATABASE_URL` directly.)

- [ ] **Step 6: Document in .env.example**

Uncomment/replace the `DIRECT_URL` line in `.env.example`:

```
# Pooled connection for runtime (transaction pooler / RDS Proxy / PgBouncer :6543).
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/starter_dev"
# Direct connection for migrations / session-only ops. Defaults to DATABASE_URL if unset.
# DIRECT_URL="postgresql://postgres:postgres@localhost:5432/starter_dev"
# Optional cap on pg pool size per process (default 5).
# DATABASE_POOL_MAX=5
```

- [ ] **Step 7: Run tests, verify pass**

Run: `pnpm --filter @workspace/database test -- keys`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/database/keys.ts packages/database/keys.test.ts packages/database/src/client.ts packages/database/prisma.config.ts .env.example
git commit -m "feat(database): support pooled DATABASE_URL + direct DIRECT_URL split"
```

---

## Task 2: Workers SQS→Lambda entrypoint

**Files:**
- Create: `apps/workers/src/lambda.ts`
- Test: `apps/workers/src/lambda.test.ts`
- Modify: `apps/workers/package.json`

**Interfaces:**
- Consumes: `handlers` (`./handlers`), `getHandler` (`./registry`), `parseJobEnvelope`, `EventName` (`@workspace/worker-queue`).
- Produces: `export async function handler(event: SQSEvent): Promise<SQSBatchResponse>`.

- [ ] **Step 1: Add aws-lambda types**

Run: `pnpm --filter @apps/workers add -D @types/aws-lambda`

- [ ] **Step 2: Write failing test**

In `apps/workers/src/lambda.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("./handlers", () => ({
  handlers: {
    "user.welcome-email": vi.fn(async () => {}),
    "webhook.deliver": vi.fn(async () => { throw new Error("boom"); }),
  },
}));

import { handler } from "./lambda";

function record(id: string, event: string) {
  return { messageId: id, body: JSON.stringify({ event, payload: {} }) } as never;
}

describe("workers lambda", () => {
  it("acks all when handlers succeed", async () => {
    const res = await handler({ Records: [record("1", "user.welcome-email")] } as never);
    expect(res.batchItemFailures).toEqual([]);
  });

  it("reports only the failing record", async () => {
    const res = await handler({
      Records: [record("1", "user.welcome-email"), record("2", "webhook.deliver")],
    } as never);
    expect(res.batchItemFailures).toEqual([{ itemIdentifier: "2" }]);
  });

  it("reports poison (invalid JSON) as a failure, not a drop", async () => {
    const res = await handler({ Records: [{ messageId: "3", body: "not-json" } as never] } as never);
    expect(res.batchItemFailures).toEqual([{ itemIdentifier: "3" }]);
  });
});
```

- [ ] **Step 3: Run test, verify fail**

Run: `pnpm --filter @apps/workers test -- lambda`
Expected: FAIL — `./lambda` not found.

- [ ] **Step 4: Implement the handler**

Create `apps/workers/src/lambda.ts`:

```ts
import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { parseJobEnvelope, type EventName } from "@workspace/worker-queue";
import { getHandler, type HandlerRegistry } from "./registry";
import { handlers } from "./handlers";

/**
 * SQS event source mapping entrypoint (AWS profile). Reuses the shared handler
 * registry. Enable ReportBatchItemFailures on the mapping so returned
 * itemIdentifiers redrive individually to the DLQ.
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];
  for (const record of event.Records) {
    try {
      const envelope = parseJobEnvelope(JSON.parse(record.body));
      const run = getHandler(handlers as HandlerRegistry, envelope.event as EventName);
      await run(envelope.payload as never);
    } catch (err) {
      console.error(`[workers] failed ${record.messageId}`, err);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `pnpm --filter @apps/workers test -- lambda`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/workers/src/lambda.ts apps/workers/src/lambda.test.ts apps/workers/package.json
git commit -m "feat(workers): add additive SQS->Lambda entrypoint for AWS profile"
```

---

## Task 3: Typed AWS env config

**Files:**
- Create: `infra/shared/aws-env-config.ts`
- Test: `infra/shared/aws-env-config.test.ts`

**Interfaces:**
- Consumes: `ComplianceMode` from `infra/shared/compliance.ts`.
- Produces: `AwsEnvConfig`, `DeepPartialAwsEnvConfig`, `composeEnvConfig`, `validateEnvConfig`, `defineAwsEnvConfig`.

- [ ] **Step 1: Write failing test**

In `infra/shared/aws-env-config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { composeEnvConfig, validateEnvConfig, type AwsEnvConfig } from "./aws-env-config";

const base: AwsEnvConfig = {
  schemaVersion: 1,
  aws: { region: "us-east-1", accountId: "" },
  complianceMode: "none",
  network: { vpcCidr: "10.30.0.0/16", multiAzNat: false },
  database: { instanceClass: "db.t4g.micro", allocatedStorage: 20, multiAz: false, engineVersion: "16" },
  apps: { imageTag: "latest", minSize: 1, maxSize: 5, maxConcurrency: 100 },
};

describe("aws-env-config", () => {
  it("layers overrides over base", () => {
    const prod = composeEnvConfig(base, { complianceMode: "soc2", database: { multiAz: true } });
    expect(prod.complianceMode).toBe("soc2");
    expect(prod.database.multiAz).toBe(true);
    expect(prod.database.instanceClass).toBe("db.t4g.micro");
  });

  it("flags missing region and account for compliant envs", () => {
    const r = validateEnvConfig({ ...base, aws: { region: "", accountId: "" }, complianceMode: "hipaa" }, "production");
    expect(r.ok).toBe(false);
    expect(r.critical.join(" ")).toMatch(/region/i);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `pnpm --filter ./infra/... test -- aws-env-config`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the config module**

Create `infra/shared/aws-env-config.ts` (mirror the shape of `gcp-env-config.ts`):

```ts
import type { ComplianceMode } from "./compliance";

export type AwsEnvName = "sandbox" | "staging" | "production";
export const SUPPORTED_SCHEMA_VERSION = 1;

export interface AwsNetworkConfig { vpcCidr: string; multiAzNat: boolean; }
export interface AwsDatabaseConfig {
  instanceClass: string; allocatedStorage: number; multiAz: boolean; engineVersion: string;
}
export interface AwsAppsConfig {
  imageTag: string; minSize: number; maxSize: number; maxConcurrency: number;
}
export interface AwsEnvConfig {
  schemaVersion: number;
  aws: { region: string; accountId: string };
  complianceMode: ComplianceMode;
  network: AwsNetworkConfig;
  database: AwsDatabaseConfig;
  apps: AwsAppsConfig;
}

export type DeepPartialAwsEnvConfig = {
  [K in keyof AwsEnvConfig]?: AwsEnvConfig[K] extends object
    ? { [P in keyof AwsEnvConfig[K]]?: AwsEnvConfig[K][P] } : AwsEnvConfig[K];
};

export function defineAwsEnvConfig(c: AwsEnvConfig): AwsEnvConfig { return c; }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function deepMerge<T extends object>(user: Partial<T>, defaults: T): T {
  const out = structuredClone(defaults);
  for (const key of Object.keys(user) as (keyof T)[]) {
    const value = user[key];
    if (value === undefined) continue;
    const dv = out[key];
    out[key] = isPlainObject(value) && isPlainObject(dv)
      ? (deepMerge(value as Partial<object>, dv as object) as T[keyof T])
      : (value as T[keyof T]);
  }
  return out;
}
export function composeEnvConfig(base: AwsEnvConfig, ...overlays: DeepPartialAwsEnvConfig[]): AwsEnvConfig {
  return overlays.reduce<AwsEnvConfig>((acc, o) => deepMerge(o as Partial<AwsEnvConfig>, acc), base);
}

export interface ValidateResult { ok: boolean; critical: string[]; warnings: string[]; }
export function validateEnvConfig(config: AwsEnvConfig, _env: AwsEnvName): ValidateResult {
  const critical: string[] = []; const warnings: string[] = [];
  if (config.schemaVersion !== SUPPORTED_SCHEMA_VERSION) critical.push("Unsupported schemaVersion.");
  if (!config.aws.region?.trim()) critical.push("Missing aws.region.");
  if (config.complianceMode !== "none" && !config.aws.accountId?.trim())
    warnings.push("complianceMode set but aws.accountId empty (needed for some ARNs).");
  return { ok: critical.length === 0, critical, warnings };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter ./infra/... test -- aws-env-config`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/shared/aws-env-config.ts infra/shared/aws-env-config.test.ts
git commit -m "feat(infra): add typed AWS env-config layer"
```

---

## Task 4: AWS env config profiles

**Files:**
- Create: `infra/aws/config.common.ts`, `config.sandbox.ts`, `config.staging.ts`, `config.production.ts`

**Interfaces:**
- Consumes: `composeEnvConfig`, `defineAwsEnvConfig` from Task 3.
- Produces: `config` export per env file.

- [ ] **Step 1: Write the base + envs**

`infra/aws/config.common.ts`:

```ts
import { defineAwsEnvConfig } from "../shared/aws-env-config";

export const envBaseConfig = defineAwsEnvConfig({
  schemaVersion: 1,
  aws: { region: "us-east-1", accountId: "" },
  complianceMode: "none",
  network: { vpcCidr: "10.30.0.0/16", multiAzNat: false },
  database: { instanceClass: "db.t4g.micro", allocatedStorage: 20, multiAz: false, engineVersion: "16" },
  apps: { imageTag: "latest", minSize: 1, maxSize: 5, maxConcurrency: 100 },
});
```

`infra/aws/config.sandbox.ts`:

```ts
import { envBaseConfig } from "./config.common";
import { composeEnvConfig } from "../shared/aws-env-config";
export const config = composeEnvConfig(envBaseConfig, { aws: { accountId: "" } });
```

`infra/aws/config.production.ts`:

```ts
import { envBaseConfig } from "./config.common";
import { composeEnvConfig } from "../shared/aws-env-config";
export const productionConfig = composeEnvConfig(envBaseConfig, {
  complianceMode: "soc2",
  network: { multiAzNat: true },
  database: { instanceClass: "db.t4g.medium", allocatedStorage: 50, multiAz: true },
  apps: { imageTag: "v0.1.0", minSize: 1, maxSize: 25, maxConcurrency: 80 },
});
export const config = productionConfig;
```

`infra/aws/config.staging.ts`:

```ts
import { productionConfig } from "./config.production";
import { composeEnvConfig } from "../shared/aws-env-config";
export const config = composeEnvConfig(productionConfig, {
  complianceMode: "soc2",
  network: { multiAzNat: false },
  database: { instanceClass: "db.t4g.small", multiAz: false },
});
```

- [ ] **Step 2: Type-check**

Run: `pnpm type-check`
Expected: PASS (no unused/mismatched fields).

- [ ] **Step 3: Commit**

```bash
git add infra/aws/config.common.ts infra/aws/config.sandbox.ts infra/aws/config.staging.ts infra/aws/config.production.ts
git commit -m "feat(infra): add AWS env config profiles (sandbox/staging/production)"
```

---

## Task 5: AWS compliance resources module

**Files:**
- Create: `infra/aws/compliance-resources.ts`
- Test: `infra/aws/compliance-resources.test.ts`

**Interfaces:**
- Consumes: `ComplianceConfig` from `infra/shared/compliance.ts`.
- Produces: `buildComplianceResources(args): { kmsKeyArn: pulumi.Output<string>; logBucketName: pulumi.Output<string> }` — no-op when all flags false.

- [ ] **Step 1: Write failing mock test**

In `infra/aws/compliance-resources.test.ts`, use `pulumi.runtime.setMocks` to capture created resource types, then assert: `resolveCompliance("none")` → zero KMS/CloudTrail/S3-log resources; `resolveCompliance("hipaa")` → a `kms/key`, a `cloudtrail/trail`, an `s3/bucketV2` with object-lock, and a `wafv2/webAcl`. (Model the mock harness on `infra/gcp/bootstrap/compliance.mock.test.ts`.)

- [ ] **Step 2: Run test, verify fail**

Run: `pnpm --filter ./infra/... test -- compliance-resources`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the mapping**

Create `infra/aws/compliance-resources.ts` that, given a `ComplianceConfig`:
- `cmek` → `new aws.kms.Key(...)` (rotation enabled) + alias; return its ARN (else `""`).
- `immutableLogSink` → `new aws.s3.BucketV2` with `objectLockEnabled: true` + `BucketObjectLockConfigurationV2` retention `= logRetentionDays` (COMPLIANCE mode).
- `auditLogs` → `new aws.cloudtrail.Trail` with S3/Secrets Manager data events, writing to the log bucket.
- `cloudArmor` → `new aws.wafv2.WebAcl` (regional) for later App Runner association.
- `orgPolicies` → `aws.cfg.Rule` managed rules (e.g. `RDS_INSTANCE_PUBLIC_ACCESS_CHECK`, `S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED`).
- When every flag is false, create nothing and return `{ kmsKeyArn: pulumi.output(""), logBucketName: pulumi.output("") }`.

Follow the structure of `infra/gcp/bootstrap/compliance-resources.ts` (guard each block behind its flag).

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter ./infra/... test -- compliance-resources`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/aws/compliance-resources.ts infra/aws/compliance-resources.test.ts
git commit -m "feat(infra): map compliance flags to AWS resources (KMS/CloudTrail/WAF/ObjectLock)"
```

---

## Task 6: Core layer — VPC + private RDS + RDS Proxy + SQS + S3 + Secrets

**Files:**
- Modify: `infra/aws/core/index.ts`

**Interfaces:**
- Consumes: `config` from `infra/aws/config.<env>.ts` via Pulumi config; `resolveCompliance`; `buildComplianceResources`.
- Produces stack outputs: `vpcId`, `privateSubnetIds`, `appSecurityGroupId`, `dbProxyEndpoint`, `databaseUrlSecretArn`, `directUrlSecretArn`, `sqsQueueUrl`, `sqsQueueArn`, `sqsDlqArn`, `uploadsBucket`, `kmsKeyArn`.

- [ ] **Step 1: Build the network + RDS + proxy**

Rewrite `infra/aws/core/index.ts` to always create:
- A VPC (`aws.ec2.Vpc`, `network.vpcCidr`) with public + private subnets across 2 AZs, an IGW, and NAT (`multiAzNat ? one-per-AZ : single`).
- Security groups: `db-sg` (ingress 5432 from `app-sg`), `app-sg`.
- `aws.rds.SubnetGroup` (private subnets), `aws.rds.Instance` with `publiclyAccessible: false`, `multiAz: config.database.multiAz`, `storageEncrypted: true`, `kmsKeyId: kmsKeyArn || undefined`, `deletionProtection: true`, `backupRetentionPeriod: 7`.
- `aws.rds.Proxy` (`engineFamily: "POSTGRESQL"`) + `aws.rds.ProxyDefaultTargetGroup` + `aws.rds.ProxyTarget` pointing at the instance, in private subnets, using a Secrets Manager auth secret.
- SQS queue + DLQ (carry over the existing definitions).
- `aws.s3.BucketV2` uploads bucket (SSE-KMS when `cmek`).
- Secrets Manager: `database-url` (pooled → `postgresql://…@<proxyEndpoint>/starter`) and `direct-url` (direct → `…@<rdsEndpoint>/starter`).
- Call `buildComplianceResources(resolveCompliance(complianceMode, { logRetentionDays, ... }))` and apply `kmsKeyArn` to RDS/S3/SQS/Secrets.

Read config via a small loader: `import { config } from "../config.<env>"` is not possible per-stack, so read Pulumi config keys fanned out by a configure step (mirror GCP), or read the env name from `pulumi.getStack()` and import the matching config file. Use the stack-name→config approach:

```ts
import * as pulumi from "@pulumi/pulumi";
const env = pulumi.getStack() as "sandbox" | "staging" | "production";
const { config } = await import(`../config.${env}`);
```

- [ ] **Step 2: Preview compiles**

Run: `cd infra/aws/core && pnpm install && pulumi preview -s sandbox` (or `pnpm type-check` at repo root for TS).
Expected: type-checks; preview shows VPC + RDS + Proxy + SQS + S3 + Secrets.

- [ ] **Step 3: Commit**

```bash
git add infra/aws/core/index.ts
git commit -m "feat(infra): AWS core with private RDS + RDS Proxy + VPC + compliance"
```

---

## Task 7: Apps layer — App Runner ×4 + workers Lambda + schedules

**Files:**
- Rewrite: `infra/aws/apps/index.ts`

**Interfaces:**
- Consumes core outputs (StackReference): `privateSubnetIds`, `appSecurityGroupId`, `databaseUrlSecretArn`, `sqsQueueArn`, `sqsQueueUrl`, `uploadsBucket`.
- Produces: App Runner service URLs; Lambda function ARN.

- [ ] **Step 1: App Runner service factory**

For each of `dashboard`, `www`, `public-api`, `public-mcp`:
- `aws.apprunner.VpcConnector` (shared) bound to `privateSubnetIds` + `appSecurityGroupId`.
- `aws.apprunner.Service` with `sourceConfiguration.imageRepository` (ECR `imageIdentifier` SHA/tag), `instanceConfiguration` (cpu/memory), `networkConfiguration.egressConfiguration` = the VPC connector, `healthCheckConfiguration.path` = the app's `healthPath` from `infra/shared/apps.manifest.ts`, and `autoScalingConfigurationArn` from an `aws.apprunner.AutoScalingConfigurationVersion` (`minSize`/`maxSize`/`maxConcurrency` from config).
- Inject secrets via `runtimeEnvironmentSecrets` (`DATABASE_URL` → secret ARN) and env via `runtimeEnvironmentVariables` (`WORKER_QUEUE_ADAPTER=sqs`, `SQS_QUEUE_URL`, public URLs).
- When `cloudArmor`, associate the WAF WebACL (`aws.wafv2.WebAclAssociation`) with each public service.

Use a loop over an array mirroring the current Fargate `apps` array (drop `workers` — it moves to Lambda).

- [ ] **Step 2: Workers Lambda + SQS event source mapping**

- `aws.lambda.Function` (`runtime: "nodejs20.x"` or container image from ECR), `handler: "lambda.handler"`, in-VPC (`vpcConfig` = private subnets + app-sg), env `WORKER_QUEUE_ADAPTER=sqs`, `SQS_QUEUE_URL`, `DATABASE_URL` from secret.
- IAM role with SQS consume + Secrets read + (S3 as needed).
- `aws.lambda.EventSourceMapping` (`eventSourceArn: sqsQueueArn`, `functionResponseTypes: ["ReportBatchItemFailures"]`, `batchSize: 10`).

- [ ] **Step 3: EventBridge scheduled jobs**

For each repeatable job currently in `apps/workers/src/scheduled.ts` (e.g. `cleanup.expired-sessions`), create `aws.scheduler.Schedule` with a cron expression (from config or constant) targeting either the workers Lambda directly or an SQS `SendMessage` with the job envelope.

- [ ] **Step 4: Preview compiles**

Run: `cd infra/aws/apps && pnpm install && pulumi preview -s sandbox`
Expected: 4 App Runner services + Lambda + event source mapping + schedules; no ECS/ALB resources.

- [ ] **Step 5: Commit**

```bash
git add infra/aws/apps/index.ts
git commit -m "feat(infra): AWS apps on App Runner + workers Lambda + EventBridge schedules"
```

---

## Task 8: CI/CD pipeline

**Files:**
- Modify: `.github/workflows/deploy-aws.yml`

- [ ] **Step 1: Update the deploy job order**

Reorder the `deploy` job to: build+push 5 SHA-pinned images to ECR → `prisma migrate deploy` against `DIRECT_URL` (gate) → `pulumi up` core → `pulumi up` apps (App Runner rolling + Lambda publish) → smoke-test `GET /api/health` on the dashboard App Runner URL. Keep OIDC auth and the `production-aws` environment gate. Update IAM policy notes in the README to include `AWSAppRunnerFullAccess` and `AWSLambda_FullAccess`, drop ECS.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy-aws.yml
git commit -m "ci(infra): AWS pipeline for App Runner + Lambda with migrate gate"
```

---

## Task 9: Docs

**Files:**
- Modify: `infra/aws/README.md`

- [ ] **Step 1: Rewrite for the new architecture**

Replace the ECS Fargate description with App Runner + Lambda + RDS Proxy; document the single-topology + `complianceMode` feature toggles; add the per-env cost table from the spec; update the setup/config steps to reference `infra/aws/config.<env>.ts`.

- [ ] **Step 2: Commit**

```bash
git add infra/aws/README.md
git commit -m "docs(infra): document AWS App Runner profile"
```

---

## Self-Review Notes

- Spec coverage: DB split (T1), workers Lambda (T2), typed config (T3–4), compliance mapping (T5), core VPC/RDS/Proxy/SQS/S3/Secrets (T6), App Runner + Lambda + schedules (T7), CI (T8), docs (T9). All spec sections covered.
- Additive-only app changes (Lambda entrypoint, DB URL split); poller/drain/Redis untouched — other profiles safe.
- Type consistency: `handler` (T2) matches `SQSEvent`/`SQSBatchResponse`; core outputs consumed by apps via StackReference names listed in T6/T7.
- Placeholder scan: Pulumi resource-heavy tasks (T6/T7) describe exact resources + key properties; expand to literal resource blocks during execution following the cited AWS provider types.

## Verification (end of plan)

- `pnpm type-check`
- `pnpm lint`
- `pnpm --filter @workspace/database test`
- `pnpm --filter @apps/workers test`
- `pnpm --filter ./infra/... test`
- `cd infra/aws/core && pulumi preview -s sandbox` and `cd infra/aws/apps && pulumi preview -s sandbox` with the CrossGuard policy pack
