# GCP IaC P8 — complianceMode (HIPAA/SOC2) Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Layer the cross-cutting `complianceMode` (HIPAA/SOC2) controls on top of the six existing GCP layers (P1–P6) — Data Access audit logs, an immutable bucket-locked log sink, CMEK via Cloud KMS, org-policy constraints, Essential Contacts, Binary Authorization, Cloud Armor enforcement, and optional VPC Service Controls — entirely gated by the already-built `resolveCompliance` config so the whole bundle is a no-op when `complianceMode` is `"none"`.

**Architecture:** P8 does **not** create a new Pulumi project. It **modifies the existing layers** (`bootstrap`, `database`, `storage`, `messaging`, `apps`) under `infra/gcp/`, adding compliance resources guarded by `if (compliance.<flag>) { ... }`. Because the layers are separate Pulumi projects (each its own stack per env), **each layer resolves its own compliance config from its own `complianceMode` config key** — `resolveCompliance(config.get("complianceMode") as ComplianceMode ?? "none")` — rather than relying solely on bootstrap's `complianceModeOut` output. `bootstrap` owns the project-wide foundational compliance resources (audit config, log sink, KMS, org policies, essential contacts, binary-auth policy) and gains a new locked export `kmsCryptoKeyId` (`""` when CMEK disabled). The `database`/`storage`/`messaging` layers read that key id via their existing `bootstrapStackRef` StackReference and wire CMEK into Cloud SQL / GCS / Pub/Sub (each granting the relevant Google-managed service agent `roles/cloudkms.cryptoKeyEncrypterDecrypter`). The `apps` layer enforces Binary Authorization on Cloud Run, turns on Cloud Armor rules/adaptive protection (the LB+Armor are built in P6 when `enableHttpsLb`), and optionally builds a VPC-SC perimeter.

**Tech Stack:** Pulumi (`@pulumi/pulumi` ^3, `@pulumi/gcp` ^8), TypeScript ^5.7, Vitest ^3. Reuses `infra/shared/compliance.ts` (`ComplianceMode`, `ComplianceConfig`, `resolveCompliance`) — locked in P1, already unit-tested.

**Design spec:** [`docs/superpowers/specs/2026-06-06-gcp-comprehensive-iac-design.md`](../specs/2026-06-06-gcp-comprehensive-iac-design.md) (§3 complianceMode bundle).

---

## How gating works (read first — applies to every task)

Each layer's entrypoint resolves a `ComplianceConfig` from **its own** stack config and branches on it:

```ts
import { resolveCompliance, type ComplianceMode } from "../../shared/compliance";

const compliance = resolveCompliance(
  (config.get("complianceMode") as ComplianceMode) ?? "none",
  {
    // optional overrides; both default off/unset
    logRetentionDays: config.getNumber("logRetentionDays") ?? undefined,
    vpcServiceControls: config.getBoolean("vpcServiceControls") ?? undefined,
  },
);
```

- Sandbox stacks set `complianceMode: "none"` ⇒ `resolveCompliance` returns all flags `false` ⇒ **no compliance resources are created** (the bundle is a pure no-op).
- Prod/staging stacks set `complianceMode: "soc2"` or `"hipaa"` ⇒ the relevant `if (compliance.<flag>)` blocks fire.
- Every gated block in this plan is wrapped in `if (compliance.<flag>) { ... }`. Do **not** create any compliance resource outside such a guard.

## Bootstrap export additions (locked — consumed by P2/P3/P4 via StackReference)

P8 adds one new locked output to the `bootstrap` layer (additive to the P1 contract):

| Output | Type | Disabled value | Consumed by |
|--------|------|----------------|-------------|
| `kmsCryptoKeyId` | string | `""` (CMEK off) | database, storage, messaging |

A second informational (non-contract) export `logSinkBucketName` (`""` when disabled) is added for debugging/visibility.

## File Structure

- Create: `infra/gcp/bootstrap/compliance-resources.ts` — all gated bootstrap compliance resources + `retentionSeconds(days)` helper + a `buildComplianceResources()` factory returning `{ kmsCryptoKeyId, logSinkBucketName }`
- Create: `infra/gcp/bootstrap/compliance.mock.test.ts` — L2 Pulumi mock test (none vs hipaa)
- Modify: `infra/gcp/bootstrap/index.ts` — resolve compliance, call `buildComplianceResources()`, add `kmsCryptoKeyId` + `logSinkBucketName` exports
- Modify: `infra/gcp/bootstrap/apis.ts` — (verify only) ensure `cloudkms`, `orgpolicy`, `essentialcontacts`, `binaryauthorization`, `logging` APIs are present (they are, per P1 Task 6) — no edit expected
- Modify: `infra/gcp/database/index.ts` — read `kmsCryptoKeyId`, gate Cloud SQL `encryptionKeyName` + KMS IAM on `compliance.cmek`
- Modify: `infra/gcp/storage/index.ts` — gate GCS `encryption.defaultKmsKeyName` on `compliance.cmek` using `kmsCryptoKeyId` from StackReference + KMS IAM
- Modify: `infra/gcp/messaging/index.ts` — gate Pub/Sub topic `kmsKeyName` on `compliance.cmek` + KMS IAM
- Modify: `infra/gcp/apps/index.ts` — gate Binary Authorization on Cloud Run, Cloud Armor rules/adaptive protection, optional VPC-SC perimeter
- Modify: `infra/gcp/bootstrap/Pulumi.staging.yaml` / `Pulumi.production.yaml` — document `complianceMode`, `securityContactEmail`, optional `logRetentionDays`/`vpcServiceControls`
- Modify: `infra/gcp/{database,storage,messaging,apps}/Pulumi.{staging,production}.yaml` — add `complianceMode` key (mirrors bootstrap)

## Critical Tests

**Required.** `resolveCompliance` is already unit-tested in P1 (`infra/shared/compliance.test.ts`), so P8 focuses on (1) a tiny pure helper and (2) an L2 Pulumi mock test proving the no-op vs compliant resource graph in `bootstrap`. See [`.ai/conventions/critical-tests-in-plans.md`](../../../.ai/conventions/critical-tests-in-plans.md). Colocated paths only; no `__tests__/` folders.

- `infra/gcp/bootstrap/compliance.mock.test.ts` (L2 Pulumi mock test):
  - **`complianceMode: "none"` → no compliance resources:** importing `./index` registers **no** `gcp:projects/iAMAuditConfig:IAMAuditConfig`, **no** compliance `gcp:storage/bucket:Bucket` log sink, **no** `gcp:logging/projectSink:ProjectSink`, **no** `gcp:kms/keyRing:KeyRing` / `gcp:kms/cryptoKey:CryptoKey`, **no** `gcp:orgpolicy/policy:Policy`, **no** `gcp:essentialcontacts/contact:Contact`, **no** `gcp:binaryauthorization/policy:Policy`; and `kmsCryptoKeyId` resolves to `""`.
  - **`complianceMode: "hipaa"` → bundle present + correct retention:** exactly one `IAMAuditConfig` exists with `service: "allServices"` and `auditLogConfigs` covering both `DATA_READ` and `DATA_WRITE`; the log-sink bucket is registered with a **locked** `retentionPolicy` (`isLocked: true`) whose `retentionPeriod` equals `logRetentionDays * 86400` (`2190 * 86400`); a `gcp:kms/cryptoKey:CryptoKey` is registered and `kmsCryptoKeyId` resolves to a non-empty value; the `ProjectSink` and its `BucketIAMMember` (`roles/storage.objectCreator`) are registered.
  - **helper:** unit-assert the pure `retentionSeconds(days)` helper: `retentionSeconds(2190) === 189216000`, `retentionSeconds(365) === 31536000`, `retentionSeconds(0) === 0`.

Avoid low-value tests (do not re-test `resolveCompliance`; it is covered in P1).

---

## Task 1: Bootstrap compliance resources module (`infra/gcp/bootstrap/compliance-resources.ts`)

**Files:**
- Create: `infra/gcp/bootstrap/compliance-resources.ts`

- [ ] **Step 1: Confirm the required APIs are already enabled in `apis.ts`**

Run: `cd infra/gcp/bootstrap && rg -n "cloudkms|orgpolicy|essentialcontacts|binaryauthorization|logging" apis.ts`
Expected: all five appear in `REQUIRED_APIS` (added in P1 Task 6). If any is missing, add it to `REQUIRED_APIS`; otherwise make **no** edit to `apis.ts`.

- [ ] **Step 2: Write the implementation** (`infra/gcp/bootstrap/compliance-resources.ts`)

Pure helper + a single factory that creates every gated bootstrap compliance resource and returns the values the entrypoint must export. Every block is guarded by a `compliance.<flag>` check; when `mode` is `"none"` the function creates nothing and returns empty values.

```ts
import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import type { ComplianceConfig } from "../../shared/compliance";

/** Pure: locked-retention seconds for the immutable log bucket. */
export function retentionSeconds(days: number): number {
  return Math.max(0, Math.floor(days)) * 86400;
}

export interface ComplianceResourcesArgs {
  project: string;
  region: string;
  compliance: ComplianceConfig;
  /** Email for Essential Contacts (config key `securityContactEmail`). */
  securityContactEmail?: string;
  /** Resources gate their dependsOn on the enabled-APIs barrier. */
  dependsOn?: pulumi.Resource[];
}

export interface ComplianceResourcesResult {
  /** CryptoKey resource id, or "" when CMEK is disabled. */
  kmsCryptoKeyId: pulumi.Output<string>;
  /** Immutable log-sink bucket name, or "" when disabled. */
  logSinkBucketName: pulumi.Output<string>;
}

/**
 * Creates the project-wide compliance bundle. No-op when every flag is false
 * (complianceMode "none"): returns empty outputs and registers no resources.
 */
export function buildComplianceResources(
  args: ComplianceResourcesArgs,
): ComplianceResourcesResult {
  const { project, region, compliance, securityContactEmail, dependsOn } = args;

  // --- (a) Data Access audit logs (project-wide DATA_READ + DATA_WRITE). ------
  if (compliance.auditLogs) {
    new gcp.projects.IAMAuditConfig(
      "compliance-audit-config",
      {
        project,
        service: "allServices",
        auditLogConfigs: [
          { logType: "DATA_READ" },
          { logType: "DATA_WRITE" },
          { logType: "ADMIN_READ" },
        ],
      },
      { dependsOn },
    );
  }

  // --- (b) Immutable, bucket-locked log sink. --------------------------------
  let logSinkBucketName: pulumi.Output<string> = pulumi.output("");
  if (compliance.immutableLogSink) {
    const logBucket = new gcp.storage.Bucket(
      "compliance-log-sink",
      {
        name: pulumi.interpolate`${project}-compliance-logs-${pulumi.getStack()}`,
        project,
        location: region,
        uniformBucketLevelAccess: true,
        publicAccessPrevention: "enforced",
        versioning: { enabled: true },
        // Bucket Lock: immutable, irreversible retention.
        retentionPolicy: {
          isLocked: true,
          retentionPeriod: retentionSeconds(compliance.logRetentionDays),
        },
      },
      { protect: true, dependsOn },
    );
    logSinkBucketName = logBucket.name;

    // ProjectSink with a dedicated writer identity → the log bucket.
    const sink = new gcp.logging.ProjectSink(
      "compliance-log-sink-router",
      {
        project,
        name: pulumi.interpolate`compliance-sink-${pulumi.getStack()}`,
        destination: pulumi.interpolate`storage.googleapis.com/${logBucket.name}`,
        uniqueWriterIdentity: true,
      },
      { dependsOn },
    );

    // Grant the sink's writer identity objectCreator on the bucket.
    new gcp.storage.BucketIAMMember("compliance-log-sink-writer", {
      bucket: logBucket.name,
      role: "roles/storage.objectCreator",
      member: sink.writerIdentity,
    });
  }

  // --- (c) CMEK: KMS keyring + rotating crypto key. --------------------------
  let kmsCryptoKeyId: pulumi.Output<string> = pulumi.output("");
  if (compliance.cmek) {
    const keyRing = new gcp.kms.KeyRing(
      "compliance-keyring",
      {
        project,
        name: pulumi.interpolate`starter-compliance-${pulumi.getStack()}`,
        location: region,
      },
      { protect: true, dependsOn },
    );

    const cryptoKey = new gcp.kms.CryptoKey(
      "compliance-key",
      {
        name: "starter-cmek",
        keyRing: keyRing.id,
        // 90-day rotation.
        rotationPeriod: "7776000s",
        purpose: "ENCRYPT_DECRYPT",
      },
      { protect: true },
    );
    kmsCryptoKeyId = cryptoKey.id;
  }

  // --- (d) Org-policy constraints (project-scoped). --------------------------
  if (compliance.orgPolicies) {
    const parent = `projects/${project}`;

    new gcp.orgpolicy.Policy(
      "op-restrict-public-ip",
      {
        name: `${parent}/policies/sql.restrictPublicIp`,
        parent,
        spec: { rules: [{ enforce: "TRUE" }] },
      },
      { dependsOn },
    );

    new gcp.orgpolicy.Policy(
      "op-public-access-prevention",
      {
        name: `${parent}/policies/storage.publicAccessPrevention`,
        parent,
        spec: { rules: [{ enforce: "TRUE" }] },
      },
      { dependsOn },
    );

    new gcp.orgpolicy.Policy(
      "op-allowed-policy-member-domains",
      {
        name: `${parent}/policies/iam.allowedPolicyMemberDomains`,
        parent,
        // List constraint: tighten to your org's customer IDs. Default: allow all
        // until the org admin supplies allowed values, to avoid a self-lockout.
        spec: { rules: [{ allowAll: "TRUE" }] },
      },
      { dependsOn },
    );

    new gcp.orgpolicy.Policy(
      "op-resource-locations",
      {
        name: `${parent}/policies/gcp.resourceLocations`,
        parent,
        spec: {
          rules: [
            { values: { allowedValues: [`in:${region}-locations`] } },
          ],
        },
      },
      { dependsOn },
    );
  }

  // --- (e) Essential Contacts (security category). ---------------------------
  if (compliance.mode !== "none" && securityContactEmail) {
    new gcp.essentialcontacts.Contact(
      "compliance-security-contact",
      {
        parent: `projects/${project}`,
        email: securityContactEmail,
        languageTag: "en-US",
        notificationCategorySubscriptions: ["SECURITY", "TECHNICAL"],
      },
      { dependsOn },
    );
  }

  // --- (f) Binary Authorization project policy. ------------------------------
  if (compliance.binaryAuthorization) {
    new gcp.binaryauthorization.Policy(
      "compliance-binauthz-policy",
      {
        project,
        defaultAdmissionRule: {
          evaluationMode: "REQUIRE_ATTESTATION",
          enforcementMode: "ENFORCED_BLOCK_AND_AUDIT_LOG",
          requireAttestationsBies: [],
        },
        // Allow Google-managed system images so the platform keeps working.
        admissionWhitelistPatterns: [
          { namePattern: "gcr.io/google_containers/*" },
          { namePattern: "gke.gcr.io/*" },
        ],
      },
      { dependsOn },
    );
  }

  return { kmsCryptoKeyId, logSinkBucketName };
}
```

- [ ] **Step 3: Type-check**

Run: `cd infra/gcp/bootstrap && pnpm install && npx tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 4: Commit**

```bash
git add infra/gcp/bootstrap/compliance-resources.ts
git commit -m "feat(infra): bootstrap compliance resources module (audit, log sink, kms, org policy, contacts, binauthz)"
```

## Task 2: Wire compliance resources into the bootstrap entrypoint (`infra/gcp/bootstrap/index.ts`)

**Files:**
- Modify: `infra/gcp/bootstrap/index.ts`

- [ ] **Step 1: Resolve compliance config near the top of `index.ts`**

After the existing config reads (where `complianceMode` is currently read as a plain string), add the resolution and contact email. Replace the existing `const complianceMode = config.get("complianceMode") ?? "none";` line with:

```ts
import { resolveCompliance, type ComplianceMode } from "../../shared/compliance";
import { buildComplianceResources } from "./compliance-resources";

const complianceMode = (config.get("complianceMode") as ComplianceMode) ?? "none";
const compliance = resolveCompliance(complianceMode, {
  logRetentionDays: config.getNumber("logRetentionDays") ?? undefined,
  vpcServiceControls: config.getBoolean("vpcServiceControls") ?? undefined,
});
const securityContactEmail = config.get("securityContactEmail");
```

(Keep `complianceMode` available for the existing `complianceModeOut` export.)

- [ ] **Step 2: Call the factory after the API barrier (`apis`) is defined**

Add immediately after the foundational resources are declared (it needs `apis` for `dependsOn`):

```ts
// --- Compliance bundle (gated; no-op when complianceMode is "none"). ----------
const complianceResources = buildComplianceResources({
  project,
  region,
  compliance,
  securityContactEmail,
  dependsOn: apis,
});
```

- [ ] **Step 3: Add the new exports (alongside the existing `complianceModeOut`)**

```ts
// --- Compliance exports (new locked contract addition). -----------------------
export const kmsCryptoKeyId = complianceResources.kmsCryptoKeyId;
export const logSinkBucketName = complianceResources.logSinkBucketName;
```

- [ ] **Step 4: Type-check**

Run: `cd infra/gcp/bootstrap && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/gcp/bootstrap/index.ts
git commit -m "feat(infra): wire compliance bundle + kmsCryptoKeyId export into bootstrap"
```

## Task 3: L2 mock test for bootstrap compliance (`infra/gcp/bootstrap/compliance.mock.test.ts`)

**Files:**
- Create: `infra/gcp/bootstrap/compliance.mock.test.ts`

Mirrors the P1/P3/P4 mock-test pattern: `pulumi.runtime.setMocks` with a `newResource` handler that records every registered resource, config injected via `PULUMI_CONFIG` before importing `./index`, and `vi.resetModules()` between the `"none"` and `"hipaa"` runs.

- [ ] **Step 1: Write the test** (`infra/gcp/bootstrap/compliance.mock.test.ts`)

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { retentionSeconds } from "./compliance-resources";

interface RecordedResource {
  type: string;
  name: string;
  inputs: Record<string, any>;
}

const recorded: RecordedResource[] = [];

function installMocks() {
  pulumi.runtime.setMocks(
    {
      newResource: (args) => {
        recorded.push({ type: args.type, name: args.name, inputs: args.inputs });
        return {
          id: `${args.name}-id`,
          state: { ...args.inputs, name: args.inputs.name ?? args.name },
        };
      },
      call: (args) => args.inputs,
    },
    "starter-gcp-bootstrap",
    "production",
  );
}

async function importInfra(extraConfig: Record<string, string>) {
  vi.resetModules();
  recorded.length = 0;
  process.env.PULUMI_CONFIG = JSON.stringify({
    "gcp:project": "test-project",
    "gcp:region": "us-central1",
    ...extraConfig,
  });
  installMocks();
  return import("./index");
}

function out<T>(o: pulumi.Output<T>): Promise<T> {
  return new Promise<T>((res) => o.apply(res));
}

const COMPLIANCE_TYPES = {
  auditConfig: "gcp:projects/iAMAuditConfig:IAMAuditConfig",
  sink: "gcp:logging/projectSink:ProjectSink",
  sinkWriter: "gcp:storage/bucketIAMMember:BucketIAMMember",
  keyRing: "gcp:kms/keyRing:KeyRing",
  cryptoKey: "gcp:kms/cryptoKey:CryptoKey",
  orgPolicy: "gcp:orgpolicy/policy:Policy",
  contact: "gcp:essentialcontacts/contact:Contact",
  binauthz: "gcp:binaryauthorization/policy:Policy",
} as const;

describe("retentionSeconds helper", () => {
  it("converts days to seconds", () => {
    expect(retentionSeconds(2190)).toBe(189216000);
    expect(retentionSeconds(365)).toBe(31536000);
    expect(retentionSeconds(0)).toBe(0);
  });
});

describe("bootstrap compliance (mode none)", () => {
  let infra: typeof import("./index");

  beforeAll(async () => {
    infra = await importInfra({ "starter-gcp-bootstrap:complianceMode": "none" });
  });

  afterAll(() => {
    delete process.env.PULUMI_CONFIG;
  });

  it("creates no compliance resources", () => {
    for (const t of Object.values(COMPLIANCE_TYPES)) {
      expect(recorded.filter((r) => r.type === t)).toHaveLength(0);
    }
  });

  it("exports an empty kmsCryptoKeyId", async () => {
    expect(await out(infra.kmsCryptoKeyId)).toBe("");
  });

  it("exports an empty logSinkBucketName", async () => {
    expect(await out(infra.logSinkBucketName)).toBe("");
  });
});

describe("bootstrap compliance (mode hipaa)", () => {
  let infra: typeof import("./index");

  beforeAll(async () => {
    infra = await importInfra({
      "starter-gcp-bootstrap:complianceMode": "hipaa",
      "starter-gcp-bootstrap:securityContactEmail": "security@example.com",
    });
  });

  afterAll(() => {
    delete process.env.PULUMI_CONFIG;
  });

  it("creates exactly one audit config covering DATA_READ + DATA_WRITE", () => {
    const cfgs = recorded.filter((r) => r.type === COMPLIANCE_TYPES.auditConfig);
    expect(cfgs).toHaveLength(1);
    expect(cfgs[0].inputs.service).toBe("allServices");
    const logTypes = (cfgs[0].inputs.auditLogConfigs as Array<{ logType: string }>).map(
      (c) => c.logType,
    );
    expect(logTypes).toContain("DATA_READ");
    expect(logTypes).toContain("DATA_WRITE");
  });

  it("creates a bucket-locked log sink with 2190-day retention", () => {
    const buckets = recorded.filter(
      (r) =>
        r.type === "gcp:storage/bucket:Bucket" &&
        r.inputs.retentionPolicy !== undefined,
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0].inputs.retentionPolicy.isLocked).toBe(true);
    expect(buckets[0].inputs.retentionPolicy.retentionPeriod).toBe(2190 * 86400);
  });

  it("creates the project sink + objectCreator writer binding", () => {
    expect(recorded.filter((r) => r.type === COMPLIANCE_TYPES.sink)).toHaveLength(1);
    const writer = recorded.filter((r) => r.type === COMPLIANCE_TYPES.sinkWriter);
    expect(writer).toHaveLength(1);
    expect(writer[0].inputs.role).toBe("roles/storage.objectCreator");
  });

  it("creates a KMS crypto key and exports a non-empty kmsCryptoKeyId", async () => {
    expect(recorded.filter((r) => r.type === COMPLIANCE_TYPES.cryptoKey)).toHaveLength(1);
    expect(await out(infra.kmsCryptoKeyId)).not.toBe("");
  });

  it("creates org policies, an essential contact, and a binauthz policy", () => {
    expect(recorded.filter((r) => r.type === COMPLIANCE_TYPES.orgPolicy).length).toBeGreaterThan(0);
    expect(recorded.filter((r) => r.type === COMPLIANCE_TYPES.contact)).toHaveLength(1);
    expect(recorded.filter((r) => r.type === COMPLIANCE_TYPES.binauthz)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd infra/gcp/bootstrap && pnpm install && pnpm vitest run compliance.mock.test.ts`
Expected: PASS. If config injection via `PULUMI_CONFIG` does not resolve, set config through `pulumi.runtime.setAllConfig({ ... })` before importing `./index` (mirroring the P1 fallback note), and re-run.

- [ ] **Step 3: Commit**

```bash
git add infra/gcp/bootstrap/compliance.mock.test.ts
git commit -m "test(infra): pulumi mock test for bootstrap compliance bundle"
```

## Task 4: CMEK wiring into the `database` layer (`infra/gcp/database/index.ts`)

**Files:**
- Modify: `infra/gcp/database/index.ts`

CMEK on Cloud SQL requires the Cloud SQL service agent to hold `roles/cloudkms.cryptoKeyEncrypterDecrypter` on the key **before** the instance is created. The key id comes from the `bootstrap` StackReference output `kmsCryptoKeyId` (`""` ⇒ CMEK disabled).

- [ ] **Step 1: Resolve compliance + read the KMS key id from bootstrap**

Add near the existing config/StackReference reads:

```ts
import { resolveCompliance, type ComplianceMode } from "../../shared/compliance";

const compliance = resolveCompliance(
  (config.get("complianceMode") as ComplianceMode) ?? "none",
);

// kmsCryptoKeyId is "" when bootstrap created no key (CMEK disabled).
const kmsCryptoKeyId = bootstrap
  .getOutput("kmsCryptoKeyId")
  .apply((v) => (v as string) ?? "");
```

- [ ] **Step 2: Grant the Cloud SQL service agent + set `encryptionKeyName` (gated on `compliance.cmek`)**

Add before the `gcp.sql.DatabaseInstance` resource, and pass the key + a `dependsOn` on the IAM grant into the instance:

```ts
// --- CMEK for Cloud SQL (gated). ---------------------------------------------
let sqlEncryptionKeyName: pulumi.Input<string> | undefined;
let sqlKmsDeps: pulumi.Resource[] = [];
if (compliance.cmek) {
  const projectInfo = gcp.organizations.getProjectOutput({ projectId: project });
  // Cloud SQL service agent: service-<projectNumber>@gcp-sa-cloud-sql.iam.gserviceaccount.com
  const sqlServiceAgent = projectInfo.number.apply(
    (n) => `serviceAccount:service-${n}@gcp-sa-cloud-sql.iam.gserviceaccount.com`,
  );
  const sqlKmsBinding = new gcp.kms.CryptoKeyIAMMember("sql-cmek-binding", {
    cryptoKeyId: kmsCryptoKeyId,
    role: "roles/cloudkms.cryptoKeyEncrypterDecrypter",
    member: sqlServiceAgent,
  });
  sqlEncryptionKeyName = kmsCryptoKeyId;
  sqlKmsDeps = [sqlKmsBinding];
}
```

Then add `encryptionKeyName: sqlEncryptionKeyName` to the existing `gcp.sql.DatabaseInstance` args (Pulumi ignores `undefined`), and merge `sqlKmsDeps` into its `dependsOn` (e.g. `{ protect: isProtectedEnv, dependsOn: [...existingDeps, ...sqlKmsDeps] }`).

- [ ] **Step 3: Add the `complianceMode` config key to the database stack files**

Add `starter-gcp-database:complianceMode: "soc2"` (production) / `"none"` (sandbox) to the respective `Pulumi.*.yaml` files (mirror bootstrap's values per env).

- [ ] **Step 4: Type-check**

Run: `cd infra/gcp/database && pnpm install && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/gcp/database/index.ts infra/gcp/database/Pulumi.sandbox.yaml infra/gcp/database/Pulumi.staging.yaml infra/gcp/database/Pulumi.production.yaml
git commit -m "feat(infra): wire CMEK into cloud sql when complianceMode enabled"
```

## Task 5: CMEK wiring into the `storage` layer (`infra/gcp/storage/index.ts`)

**Files:**
- Modify: `infra/gcp/storage/index.ts`

P3 already supports an optional `kmsKeyName` config input that sets `encryption.defaultKmsKeyName`. P8 replaces the manual config with the bootstrap key id, gated on `compliance.cmek`, and adds the required GCS service-agent IAM grant.

- [ ] **Step 1: Resolve compliance + read the KMS key id from bootstrap**

```ts
import { resolveCompliance, type ComplianceMode } from "../../shared/compliance";

const compliance = resolveCompliance(
  (config.get("complianceMode") as ComplianceMode) ?? "none",
);

const kmsCryptoKeyId = bootstrap
  .getOutput("kmsCryptoKeyId")
  .apply((v) => (v as string) ?? "");
```

- [ ] **Step 2: Grant the GCS service agent + set `defaultKmsKeyName` (gated on `compliance.cmek`)**

Replace the P3 `kmsKeyName` config branch with a compliance-driven one:

```ts
// --- CMEK for GCS (gated). ---------------------------------------------------
let bucketEncryption: { defaultKmsKeyName: pulumi.Input<string> } | undefined;
let gcsKmsDeps: pulumi.Resource[] = [];
if (compliance.cmek) {
  // GCS service agent: service-<projectNumber>@gs-project-accounts.iam.gserviceaccount.com
  const gcsServiceAgent = gcp.storage.getProjectServiceAccountOutput({ project });
  const gcsKmsBinding = new gcp.kms.CryptoKeyIAMMember("gcs-cmek-binding", {
    cryptoKeyId: kmsCryptoKeyId,
    role: "roles/cloudkms.cryptoKeyEncrypterDecrypter",
    member: gcsServiceAgent.member, // already "serviceAccount:..."
  });
  bucketEncryption = { defaultKmsKeyName: kmsCryptoKeyId };
  gcsKmsDeps = [gcsKmsBinding];
}
```

Then change the bucket's `encryption` spread to use `bucketEncryption` (`...(bucketEncryption ? { encryption: bucketEncryption } : {})`) and merge `gcsKmsDeps` into the bucket's `dependsOn`.

- [ ] **Step 3: Add the `complianceMode` config key to the storage stack files**

Add `starter-gcp-storage:complianceMode` per env (mirror bootstrap). Leave the legacy `kmsKeyName` comment but note it is now superseded by the compliance-gated wiring.

- [ ] **Step 4: Type-check**

Run: `cd infra/gcp/storage && pnpm install && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/gcp/storage/index.ts infra/gcp/storage/Pulumi.sandbox.yaml infra/gcp/storage/Pulumi.staging.yaml infra/gcp/storage/Pulumi.production.yaml
git commit -m "feat(infra): wire CMEK into gcs uploads bucket when complianceMode enabled"
```

## Task 6: CMEK wiring into the `messaging` layer (`infra/gcp/messaging/index.ts`)

**Files:**
- Modify: `infra/gcp/messaging/index.ts`

CMEK on Pub/Sub sets `kmsKeyName` on the topic and requires the Pub/Sub service agent to hold the encrypter/decrypter role on the key.

- [ ] **Step 1: Resolve compliance + read the KMS key id from bootstrap**

```ts
import { resolveCompliance, type ComplianceMode } from "../../shared/compliance";

const compliance = resolveCompliance(
  (config.get("complianceMode") as ComplianceMode) ?? "none",
);

const kmsCryptoKeyId = bootstrap
  .getOutput("kmsCryptoKeyId")
  .apply((v) => (v as string) ?? "");
```

- [ ] **Step 2: Grant the Pub/Sub service agent + set `kmsKeyName` on the topic (gated on `compliance.cmek`)**

Add before the `gcp.pubsub.Topic("jobs", ...)` resource:

```ts
// --- CMEK for Pub/Sub (gated). -----------------------------------------------
let topicKmsKeyName: pulumi.Input<string> | undefined;
let pubsubKmsDeps: pulumi.Resource[] = [];
if (compliance.cmek) {
  const projectInfo = gcp.organizations.getProjectOutput({ projectId: project });
  // Pub/Sub service agent: service-<projectNumber>@gcp-sa-pubsub.iam.gserviceaccount.com
  const pubsubServiceAgent = projectInfo.number.apply(
    (n) => `serviceAccount:service-${n}@gcp-sa-pubsub.iam.gserviceaccount.com`,
  );
  const pubsubKmsBinding = new gcp.kms.CryptoKeyIAMMember("pubsub-cmek-binding", {
    cryptoKeyId: kmsCryptoKeyId,
    role: "roles/cloudkms.cryptoKeyEncrypterDecrypter",
    member: pubsubServiceAgent,
  });
  topicKmsKeyName = kmsCryptoKeyId;
  pubsubKmsDeps = [pubsubKmsBinding];
}
```

Then add `kmsKeyName: topicKmsKeyName` to the `jobs` topic args (and the DLQ topic if desired), and pass `{ dependsOn: pubsubKmsDeps }` as the topic's resource options. The Pub/Sub block otherwise stays exactly as P4 defined it.

- [ ] **Step 3: Add the `complianceMode` config key to the messaging stack files**

Add `starter-gcp-messaging:complianceMode` per env (mirror bootstrap).

- [ ] **Step 4: Type-check**

Run: `cd infra/gcp/messaging && pnpm install && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/gcp/messaging/index.ts infra/gcp/messaging/Pulumi.sandbox.yaml infra/gcp/messaging/Pulumi.staging.yaml infra/gcp/messaging/Pulumi.production.yaml
git commit -m "feat(infra): wire CMEK into pubsub topic when complianceMode enabled"
```

## Task 7: Binary Authorization + Cloud Armor enforcement in the `apps` layer (`infra/gcp/apps/index.ts`)

**Files:**
- Modify: `infra/gcp/apps/index.ts`

P6 already builds the global HTTPS LB + Cloud Armor security policy **when `enableHttpsLb`**. P8 (a) requires Binary Authorization on every Cloud Run service when `compliance.binaryAuthorization`, and (b) ensures Cloud Armor rules + adaptive protection are turned on when `compliance.cloudArmor`. Both are gated; neither creates resources when `complianceMode` is `"none"`.

- [ ] **Step 1: Resolve compliance in the apps entrypoint**

```ts
import { resolveCompliance, type ComplianceMode } from "../../shared/compliance";

const compliance = resolveCompliance(
  (config.get("complianceMode") as ComplianceMode) ?? "none",
  { vpcServiceControls: config.getBoolean("vpcServiceControls") ?? undefined },
);
```

- [ ] **Step 2: Binary Authorization on each Cloud Run service (gated)**

Where each `gcp.cloudrunv2.Service` is created (the per-app loop), conditionally add the `binaryAuthorization` block so the service requires attestation per the bootstrap project policy:

```ts
// Inside the per-app Cloud Run service args:
...(compliance.binaryAuthorization
  ? { binaryAuthorization: { useDefault: true } }
  : {}),
```

`useDefault: true` makes the service evaluate against the project-level Binary Authorization policy created in `bootstrap` (Task 1f). Document in a comment that this is a no-op unless the bootstrap policy exists (i.e. the same `complianceMode` is set on both layers).

- [ ] **Step 3: Cloud Armor rules + adaptive protection (gated)**

Locate the P6 `gcp.compute.SecurityPolicy` (only created when `enableHttpsLb`). Make the hardening rules conditional on `compliance.cloudArmor`. When the LB is enabled AND compliant, attach rate-limiting + adaptive protection:

```ts
// Only relevant when the LB (and thus the security policy) exists (enableHttpsLb).
// When compliant, enable adaptive protection + a default rate-limit rule.
const armorRules = compliance.cloudArmor
  ? [
      {
        action: "rate_based_ban",
        priority: 1000,
        match: {
          versionedExpr: "SRC_IPS_V1",
          config: { srcIpRanges: ["*"] },
        },
        rateLimitOptions: {
          conformAction: "allow",
          exceedAction: "deny(429)",
          enforceOnKey: "IP",
          rateLimitThreshold: { count: 100, intervalSec: 60 },
        },
        description: "Per-IP rate limiting (compliance).",
      },
    ]
  : [];

// When building the SecurityPolicy (inside the enableHttpsLb block), spread the
// compliance rules and toggle adaptive protection:
//   rules: [ ...armorRules, /* existing default allow rule (priority 2147483647) */ ],
//   ...(compliance.cloudArmor
//     ? { adaptiveProtectionConfig: { layer7DdosDefenseConfig: { enable: true } } }
//     : {}),
```

Document the interaction explicitly in a comment: **P6 owns the LB + base Cloud Armor policy (built only when `enableHttpsLb`); P8 only adds rate-limit rules + adaptive protection when `compliance.cloudArmor`.** If `enableHttpsLb` is false there is no security policy to harden (Cloud Armor requires the LB).

- [ ] **Step 4: Add the `complianceMode` config key to the apps stack files**

Add `starter-gcp-apps:complianceMode` per env (mirror bootstrap). Note that prod typically also sets `enableHttpsLb: "true"` so Cloud Armor has a policy to harden.

- [ ] **Step 5: Type-check**

Run: `cd infra/gcp/apps && pnpm install && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infra/gcp/apps/index.ts infra/gcp/apps/Pulumi.sandbox.yaml infra/gcp/apps/Pulumi.staging.yaml infra/gcp/apps/Pulumi.production.yaml
git commit -m "feat(infra): enforce binary authorization + cloud armor when complianceMode enabled"
```

## Task 8: Optional VPC Service Controls perimeter in the `apps` layer (`infra/gcp/apps/index.ts`)

**Files:**
- Modify: `infra/gcp/apps/index.ts`

VPC-SC is an **optional sub-flag** (`compliance.vpcServiceControls`), **off by default even in HIPAA/SOC2** (see `resolveCompliance` — only the `vpcServiceControls` override turns it on). It requires an **org-level Access Context Manager access policy id** supplied via config; without it the perimeter cannot be created, so it stays off unless explicitly opted in.

- [ ] **Step 1: Read the optional access policy id**

```ts
// Org-level Access Context Manager access policy id (numeric). Required for VPC-SC.
const accessPolicyId = config.get("accessPolicyId");
```

- [ ] **Step 2: Build the perimeter only when opted in AND the access policy id is present**

```ts
// --- VPC Service Controls perimeter (optional sub-flag; off by default). ------
// Requires an org-level Access Context Manager access policy. Gated on BOTH the
// compliance sub-flag and a configured accessPolicyId to avoid a broken apply.
if (compliance.vpcServiceControls && accessPolicyId) {
  new gcp.accesscontextmanager.ServicePerimeter("starter-vpc-sc", {
    parent: `accessPolicies/${accessPolicyId}`,
    name: `accessPolicies/${accessPolicyId}/servicePerimeters/starter_${pulumi.getStack()}`,
    title: `starter-${pulumi.getStack()}`,
    status: {
      restrictedServices: [
        "run.googleapis.com",
        "sqladmin.googleapis.com",
        "storage.googleapis.com",
        "pubsub.googleapis.com",
        "secretmanager.googleapis.com",
        "cloudkms.googleapis.com",
      ],
      resources: [pulumi.interpolate`projects/${project}`],
    },
  });
}
```

Document in a comment: **VPC-SC is org-scoped and disabled by default; enabling it without a correct access policy + access levels can lock out legitimate access, so it is intentionally opt-in via `vpcServiceControls: true` AND `accessPolicyId`.**

- [ ] **Step 3: Type-check**

Run: `cd infra/gcp/apps && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add infra/gcp/apps/index.ts
git commit -m "feat(infra): optional vpc service controls perimeter (off by default)"
```

## Self-Review checklist (run after completing tasks)

- Every compliance resource sits inside an `if (compliance.<flag>) { ... }` guard; with `complianceMode: "none"` **nothing** new is created in any layer (verified by the `bootstrap` mock test).
- `bootstrap` exports `kmsCryptoKeyId` (`""` when CMEK disabled); `database`/`storage`/`messaging` read it via `bootstrapStackRef` and only wire CMEK + the service-agent `roles/cloudkms.cryptoKeyEncrypterDecrypter` binding when `compliance.cmek`.
- Each layer resolves compliance from **its own** `complianceMode` config key (not just bootstrap's output), and the same mode must be set across the layers of an environment for the controls to be consistent.
- The immutable log bucket has a **locked** retention policy of `logRetentionDays * 86400` seconds (HIPAA 2190 d, SOC2 365 d) and `{ protect: true }`; KMS keyring/key are `{ protect: true }`.
- Binary Authorization (`useDefault: true`) is set on Cloud Run only when `compliance.binaryAuthorization`; Cloud Armor rate-limit + adaptive protection are added to the P6 security policy only when `compliance.cloudArmor` and the LB exists; VPC-SC only when `vpcServiceControls` AND `accessPolicyId`.

## Verification

- `cd infra/gcp/bootstrap && npx tsc --noEmit && pnpm vitest run`
- `cd infra/gcp/database && npx tsc --noEmit`
- `cd infra/gcp/storage && npx tsc --noEmit`
- `cd infra/gcp/messaging && npx tsc --noEmit`
- `cd infra/gcp/apps && npx tsc --noEmit`
- `pulumi preview` per modified layer against a **compliant** (e.g. `production`/`soc2`) stack with the CrossGuard policy pack, plus a `none` sandbox stack to confirm the no-op.

### Out of scope (manual / non-IaC — state explicitly)

These are **not** automated by P8 and remain manual organizational responsibilities:

- **Signing the Google BAA** (Business Associate Agreement) for HIPAA — done once in the Google Cloud console/contract, outside Pulumi.
- **The SOC 2 / HIPAA audit and evidence collection** — performed by auditors against the running environment.
- **Periodic access reviews** — recurring human process, not infrastructure.
- **Keeping PHI out of application logs (app-level redaction)** — handled in application code, not by these layers.
