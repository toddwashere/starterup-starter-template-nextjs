# GCP IaC P1 — Foundations + `bootstrap` Layer Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the shared, single-source-of-truth modules in `infra/shared/` (app capabilities, secret catalog, per-app IAM derivation, compliance resolution, preflight) and the `bootstrap` Pulumi layer (API enablement, VPC, Artifact Registry, deploy SA + Workload Identity Federation, billing budget) that every other GCP layer depends on.

**Architecture:** `infra/shared/*` are pure TypeScript modules (Vitest-unit-tested, no cloud calls) imported by the Pulumi layer projects under `infra/gcp/*`. `infra/gcp/bootstrap/` is a new standalone Pulumi project (not in the pnpm workspace) that enables APIs first, then provisions foundational resources, and exports outputs consumed by `database`/`storage`/`messaging`/`secrets`/`apps` via `pulumi.StackReference`.

**Tech Stack:** Pulumi (`@pulumi/pulumi` ^3, `@pulumi/gcp` ^8, `@pulumi/random` ^4, `@pulumi/policy` ^1), TypeScript ^5.7, Vitest ^3.

**Design spec:** [`docs/superpowers/specs/2026-06-06-gcp-comprehensive-iac-design.md`](../specs/2026-06-06-gcp-comprehensive-iac-design.md)

---

## Interface Contract (locked — referenced by P2–P8)

These exact type/function names are depended on by later plans. Do not rename without updating dependents.

```ts
// infra/shared/apps.manifest.ts — AppDescriptor gains capability flags:
export interface AppDescriptor {
  name: string;
  packageName: string;
  port: number;
  healthPath: string;
  dockerfile: string;
  public: boolean;        // has public ingress (allUsers run.invoker)
  worker: boolean;        // no public ingress, low concurrency, no liveness probe
  needsDb: boolean;
  needsPubsub: boolean;
  needsStorage: boolean;
  usesRedis: boolean;
}

// infra/shared/secret-catalog.ts
export type SecretGeneration = "generated" | "placeholder";
export interface SecretDescriptor {
  id: string;       // Secret Manager secretId, e.g. "better-auth-secret"
  envVar: string;   // env var injected into Cloud Run, e.g. "BETTER_AUTH_SECRET"
  generation: SecretGeneration;
  readers: readonly string[]; // app names that read it
}
export const SECRET_CATALOG: readonly SecretDescriptor[];
export function secretsForApp(app: string): SecretDescriptor[];
export function generatedSecrets(): SecretDescriptor[];
export function placeholderSecrets(): SecretDescriptor[];

// infra/shared/app-iam.ts
export interface AppIamPlan {
  app: string;
  roles: string[];              // project-level roles, e.g. "roles/cloudsql.client"
  secretAccessorIds: string[];  // secret ids this app's SA may access
}
export function planAppIam(app: AppDescriptor): AppIamPlan;

// infra/shared/compliance.ts
export type ComplianceMode = "none" | "hipaa" | "soc2" | "hipaa+soc2";
export interface ComplianceConfig {
  mode: ComplianceMode;
  auditLogs: boolean;
  immutableLogSink: boolean;
  logRetentionDays: number;
  cmek: boolean;
  orgPolicies: boolean;
  binaryAuthorization: boolean;
  cloudArmor: boolean;
  vpcServiceControls: boolean;
}
export function resolveCompliance(
  mode: ComplianceMode,
  overrides?: { logRetentionDays?: number; vpcServiceControls?: boolean },
): ComplianceConfig;

// infra/shared/preflight.ts
export interface PreflightInput {
  authenticated: boolean;
  billingLinked: boolean;
  projectExists: boolean;
  stateBucketReachable: boolean;
  config: Record<string, string | undefined>;
  requiredKeys: readonly string[];
}
export interface PreflightResult { ok: boolean; errors: string[]; }
export function runPreflight(input: PreflightInput): PreflightResult;
```

**`bootstrap` stack outputs (locked — consumed via StackReference):**

| Output | Type | Consumed by |
|--------|------|-------------|
| `projectId` | string | all |
| `regionOut` | string | all |
| `networkId` | string ("" when disabled) | database, messaging, apps |
| `networkSelfLink` | string ("") | apps |
| `subnetSelfLink` | string ("") | apps |
| `vpcConnectorId` | string ("") | apps |
| `privateServicesConnection` | string ("") | database |
| `artifactRegistryRepo` | string (repo path) | apps, P7 |
| `deployServiceAccountEmail` | string | P7 |
| `complianceModeOut` | string | database, storage, messaging, secrets, apps |

## File Structure

- Create: `infra/shared/secret-catalog.ts` — secret catalog + lookups
- Create: `infra/shared/secret-catalog.test.ts` — L1 unit tests
- Modify: `infra/shared/apps.manifest.ts` — add capability flags to `AppDescriptor` + each app
- Create: `infra/shared/app-iam.ts` — per-app IAM derivation from manifest + secret catalog
- Create: `infra/shared/app-iam.test.ts` — L1 unit tests
- Create: `infra/shared/compliance.ts` — compliance mode resolution
- Create: `infra/shared/compliance.test.ts` — L1 unit tests
- Create: `infra/shared/preflight.ts` — pure preflight validation
- Create: `infra/shared/preflight.test.ts` — L1 unit tests
- Create: `infra/shared/vitest.config.ts` — Vitest config for the shared modules (if not already resolvable)
- Create: `infra/gcp/bootstrap/package.json`
- Create: `infra/gcp/bootstrap/Pulumi.yaml`
- Create: `infra/gcp/bootstrap/tsconfig.json`
- Create: `infra/gcp/bootstrap/.gitignore`
- Create: `infra/gcp/bootstrap/Pulumi.sandbox.yaml`
- Create: `infra/gcp/bootstrap/Pulumi.staging.yaml`
- Create: `infra/gcp/bootstrap/Pulumi.production.yaml`
- Create: `infra/gcp/bootstrap/apis.ts` — required API list + enablement
- Create: `infra/gcp/bootstrap/index.ts` — layer entrypoint (APIs, VPC, Artifact Registry, deploy SA/WIF, budget, exports)
- Create: `infra/gcp/bootstrap/bootstrap.mock.test.ts` — L2 Pulumi mock test
- Modify: `infra/shared/policies/gcp-sandbox-validators.ts` — new least-privilege validators
- Modify: `infra/shared/policies/gcp-sandbox.ts` — register new policies
- Modify: `infra/shared/policies/gcp-sandbox.test.ts` — tests for new validators

## Critical Tests

- `infra/shared/secret-catalog.test.ts`: every `readers` entry is a real app name; `generatedSecrets()`/`placeholderSecrets()` partition the catalog with no overlap; `secretsForApp("www")` is empty; `secretsForApp("dashboard")` includes `database-url` and `better-auth-secret`.
- `infra/shared/app-iam.test.ts`: `planAppIam` grants `roles/cloudsql.client` only when `needsDb`; `roles/pubsub.publisher`+`roles/pubsub.subscriber` only when worker/`needsPubsub`; `roles/storage.objectAdmin` only when `needsStorage`; `www` yields empty `roles` and `secretAccessorIds`; `secretAccessorIds` equals the ids from `secretsForApp(app.name)`.
- `infra/shared/compliance.test.ts`: `resolveCompliance("none")` disables every control; `"hipaa"` → `logRetentionDays: 2190` and all controls on; `"soc2"` → `365`; `"hipaa+soc2"` → `max(2190,365)=2190`; `overrides.logRetentionDays` wins.
- `infra/shared/preflight.test.ts`: fails with a specific message per missing precondition (auth, billing, project, state bucket, each missing required key); passes only when all hold; aggregates multiple errors.
- `infra/shared/policies/gcp-sandbox.test.ts`: new validators flag `allUsers` IAM on a non-public service; flag a runtime SA bound to `roles/owner`/`roles/editor`; ignore the same in allowed cases.

---

## Task 1: Scaffold the `bootstrap` Pulumi project

**Files:**
- Create: `infra/gcp/bootstrap/package.json`
- Create: `infra/gcp/bootstrap/Pulumi.yaml`
- Create: `infra/gcp/bootstrap/tsconfig.json`
- Create: `infra/gcp/bootstrap/.gitignore`
- Create: `infra/gcp/bootstrap/Pulumi.sandbox.yaml`
- Create: `infra/gcp/bootstrap/Pulumi.staging.yaml`
- Create: `infra/gcp/bootstrap/Pulumi.production.yaml`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "starter-gcp-bootstrap",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@pulumi/gcp": "^8",
    "@pulumi/pulumi": "^3"
  },
  "devDependencies": {
    "@types/node": "^24",
    "typescript": "^5.7",
    "vitest": "^3"
  }
}
```

- [ ] **Step 2: Create `Pulumi.yaml`**

```yaml
name: starter-gcp-bootstrap
runtime: nodejs
description: Foundational GCP resources (API enablement, VPC, Artifact Registry, deploy identity, budget)
config:
  gcp:project:
    description: GCP project ID
```

- [ ] **Step 3: Create `tsconfig.json`** (mirror `infra/gcp/core/tsconfig.json`)

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "outDir": "./dist"
  },
  "include": ["*.ts"]
}
```

- [ ] **Step 4: Create `.gitignore`**

```
.pulumi/
node_modules/
dist/
```

- [ ] **Step 5: Create `Pulumi.sandbox.yaml`**

```yaml
config:
  gcp:project: "your-sandbox-project-id"
  gcp:region: "us-central1"
  starter-gcp-bootstrap:privateNetwork: "false"
  starter-gcp-bootstrap:vpcCidr: "10.10.0.0/24"
  starter-gcp-bootstrap:complianceMode: "none"
  starter-gcp-bootstrap:budgetAmount: "50"
  # starter-gcp-bootstrap:billingAccountId: "XXXXXX-XXXXXX-XXXXXX"  # required to create budget
```

- [ ] **Step 6: Create `Pulumi.staging.yaml`**

```yaml
config:
  gcp:project: "your-staging-project-id"
  gcp:region: "us-central1"
  starter-gcp-bootstrap:privateNetwork: "true"
  starter-gcp-bootstrap:vpcCidr: "10.10.0.0/24"
  starter-gcp-bootstrap:complianceMode: "none"
  starter-gcp-bootstrap:budgetAmount: "100"
  # starter-gcp-bootstrap:billingAccountId: "XXXXXX-XXXXXX-XXXXXX"
```

- [ ] **Step 7: Create `Pulumi.production.yaml`**

```yaml
config:
  gcp:project: "your-prod-project-id"
  gcp:region: "us-central1"
  starter-gcp-bootstrap:privateNetwork: "true"
  starter-gcp-bootstrap:vpcCidr: "10.10.0.0/24"
  starter-gcp-bootstrap:complianceMode: "soc2"
  starter-gcp-bootstrap:budgetAmount: "150"
  # starter-gcp-bootstrap:billingAccountId: "XXXXXX-XXXXXX-XXXXXX"
```

- [ ] **Step 8: Commit**

```bash
git add infra/gcp/bootstrap/
git commit -m "chore(infra): scaffold gcp bootstrap pulumi project"
```

## Task 2: Secret catalog (`infra/shared/secret-catalog.ts`)

**Files:**
- Create: `infra/shared/secret-catalog.test.ts`
- Create: `infra/shared/secret-catalog.ts`

- [ ] **Step 1: Write the failing test** (`infra/shared/secret-catalog.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import {
  SECRET_CATALOG,
  secretsForApp,
  generatedSecrets,
  placeholderSecrets,
} from "./secret-catalog";

const APP_NAMES = ["dashboard", "www", "public-api", "public-mcp", "workers"];

describe("SECRET_CATALOG", () => {
  it("references only real app names in readers", () => {
    for (const s of SECRET_CATALOG) {
      for (const r of s.readers) {
        expect(APP_NAMES).toContain(r);
      }
    }
  });

  it("has unique secret ids and env vars", () => {
    const ids = SECRET_CATALOG.map((s) => s.id);
    const envs = SECRET_CATALOG.map((s) => s.envVar);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(envs).size).toBe(envs.length);
  });
});

describe("generated vs placeholder partition", () => {
  it("partitions the catalog with no overlap and full coverage", () => {
    const gen = generatedSecrets().map((s) => s.id);
    const ph = placeholderSecrets().map((s) => s.id);
    expect(gen.filter((id) => ph.includes(id))).toEqual([]);
    expect([...gen, ...ph].sort()).toEqual(SECRET_CATALOG.map((s) => s.id).sort());
  });

  it("classifies database-url and better-auth-secret as generated", () => {
    const gen = generatedSecrets().map((s) => s.id);
    expect(gen).toContain("database-url");
    expect(gen).toContain("better-auth-secret");
  });

  it("classifies stripe-secret-key as placeholder", () => {
    const ph = placeholderSecrets().map((s) => s.id);
    expect(ph).toContain("stripe-secret-key");
  });
});

describe("secretsForApp", () => {
  it("returns no secrets for www", () => {
    expect(secretsForApp("www")).toEqual([]);
  });

  it("includes database-url and better-auth-secret for dashboard", () => {
    const ids = secretsForApp("dashboard").map((s) => s.id);
    expect(ids).toContain("database-url");
    expect(ids).toContain("better-auth-secret");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd infra/shared && pnpm vitest run secret-catalog.test.ts`
Expected: FAIL — cannot resolve `./secret-catalog`.

- [ ] **Step 3: Write the implementation** (`infra/shared/secret-catalog.ts`)

```ts
export type SecretGeneration = "generated" | "placeholder";

export interface SecretDescriptor {
  /** Secret Manager secretId. */
  id: string;
  /** Env var name injected into Cloud Run from this secret. */
  envVar: string;
  /** "generated" = Pulumi creates a random value; "placeholder" = empty, dev fills. */
  generation: SecretGeneration;
  /** App names whose runtime SA may read this secret. */
  readers: readonly string[];
}

export const SECRET_CATALOG: readonly SecretDescriptor[] = [
  {
    id: "database-url",
    envVar: "DATABASE_URL",
    generation: "generated",
    readers: ["dashboard", "public-api", "public-mcp", "workers"],
  },
  {
    id: "better-auth-secret",
    envVar: "BETTER_AUTH_SECRET",
    generation: "generated",
    readers: ["dashboard", "public-api", "public-mcp"],
  },
  {
    id: "campaign-unsubscribe-secret",
    envVar: "CAMPAIGN_UNSUBSCRIBE_SECRET",
    generation: "generated",
    readers: ["dashboard", "workers"],
  },
  {
    id: "stripe-secret-key",
    envVar: "STRIPE_SECRET_KEY",
    generation: "placeholder",
    readers: ["dashboard", "public-api"],
  },
  {
    id: "stripe-webhook-secret",
    envVar: "STRIPE_WEBHOOK_SECRET",
    generation: "placeholder",
    readers: ["public-api"],
  },
  {
    id: "resend-api-key",
    envVar: "RESEND_API_KEY",
    generation: "placeholder",
    readers: ["dashboard", "public-api", "workers"],
  },
  {
    id: "openrouter-api-key",
    envVar: "OPENROUTER_API_KEY",
    generation: "placeholder",
    readers: ["dashboard", "workers"],
  },
  {
    id: "sentry-dsn",
    envVar: "SENTRY_DSN",
    generation: "placeholder",
    readers: ["dashboard", "www", "public-api", "public-mcp", "workers"],
  },
] as const;

export function secretsForApp(app: string): SecretDescriptor[] {
  return SECRET_CATALOG.filter((s) => s.readers.includes(app));
}

export function generatedSecrets(): SecretDescriptor[] {
  return SECRET_CATALOG.filter((s) => s.generation === "generated");
}

export function placeholderSecrets(): SecretDescriptor[] {
  return SECRET_CATALOG.filter((s) => s.generation === "placeholder");
}
```

Note: `sentry-dsn` is read by `www`, so `secretsForApp("www")` would be non-empty, contradicting the test. Resolve by **removing `www` from `sentry-dsn.readers`** (www gets Sentry via build-time `NEXT_PUBLIC_SENTRY_DSN`, not a runtime secret). The implementation above must list `sentry-dsn.readers` as `["dashboard", "public-api", "public-mcp", "workers"]`. Apply that before running tests.

- [ ] **Step 4: Apply the `www` fix to `sentry-dsn.readers`** so `www` reads no secrets

Edit `sentry-dsn` readers to: `["dashboard", "public-api", "public-mcp", "workers"]`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd infra/shared && pnpm vitest run secret-catalog.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infra/shared/secret-catalog.ts infra/shared/secret-catalog.test.ts
git commit -m "feat(infra): add secret catalog single source of truth"
```

## Task 3: App capability flags + per-app IAM derivation

**Files:**
- Modify: `infra/shared/apps.manifest.ts`
- Create: `infra/shared/app-iam.test.ts`
- Create: `infra/shared/app-iam.ts`

- [ ] **Step 1: Add capability flags to every app in `apps.manifest.ts`**

Update the `AppDescriptor` interface and each entry. Replace the interface and `APPS` array with:

```ts
export interface AppDescriptor {
  name: string;
  packageName: string;
  port: number;
  healthPath: string;
  dockerfile: string;
  public: boolean;
  worker: boolean;
  needsDb: boolean;
  needsPubsub: boolean;
  needsStorage: boolean;
  usesRedis: boolean;
}

export const APPS: readonly AppDescriptor[] = [
  {
    name: "dashboard",
    packageName: "@apps/dashboard",
    port: 4000,
    healthPath: "/api/health",
    dockerfile: "infra/shared/docker/Dockerfile.dashboard",
    public: true,
    worker: false,
    needsDb: true,
    needsPubsub: false,
    needsStorage: true,
    usesRedis: true,
  },
  {
    name: "www",
    packageName: "@apps/www",
    port: 4001,
    healthPath: "/api/health",
    dockerfile: "infra/shared/docker/Dockerfile.www",
    public: true,
    worker: false,
    needsDb: false,
    needsPubsub: false,
    needsStorage: false,
    usesRedis: false,
  },
  {
    name: "public-api",
    packageName: "@apps/public-api",
    port: 4002,
    healthPath: "/health",
    dockerfile: "infra/shared/docker/Dockerfile.public-api",
    public: true,
    worker: false,
    needsDb: true,
    needsPubsub: true,
    needsStorage: true,
    usesRedis: false,
  },
  {
    name: "public-mcp",
    packageName: "@apps/public-mcp",
    port: 4003,
    healthPath: "/health",
    dockerfile: "infra/shared/docker/Dockerfile.public-mcp",
    public: true,
    worker: false,
    needsDb: true,
    needsPubsub: false,
    needsStorage: false,
    usesRedis: false,
  },
  {
    name: "workers",
    packageName: "@apps/workers",
    port: 4300,
    healthPath: "/health",
    dockerfile: "apps/workers/Dockerfile",
    public: false,
    worker: true,
    needsDb: true,
    needsPubsub: true,
    needsStorage: true,
    usesRedis: false,
  },
] as const;
```

Keep the existing `APPS_BY_NAME` export at the bottom unchanged.

- [ ] **Step 2: Write the failing test** (`infra/shared/app-iam.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { planAppIam } from "./app-iam";
import { APPS_BY_NAME } from "./apps.manifest";
import { secretsForApp } from "./secret-catalog";

describe("planAppIam", () => {
  it("grants cloudsql.client only to db apps", () => {
    expect(planAppIam(APPS_BY_NAME.dashboard).roles).toContain("roles/cloudsql.client");
    expect(planAppIam(APPS_BY_NAME.www).roles).not.toContain("roles/cloudsql.client");
  });

  it("grants pubsub publisher+subscriber to workers only", () => {
    const workers = planAppIam(APPS_BY_NAME.workers).roles;
    expect(workers).toContain("roles/pubsub.publisher");
    expect(workers).toContain("roles/pubsub.subscriber");
    expect(planAppIam(APPS_BY_NAME.www).roles).not.toContain("roles/pubsub.subscriber");
  });

  it("grants storage.objectAdmin only to storage apps", () => {
    expect(planAppIam(APPS_BY_NAME.dashboard).roles).toContain("roles/storage.objectAdmin");
    expect(planAppIam(APPS_BY_NAME["public-mcp"]).roles).not.toContain("roles/storage.objectAdmin");
  });

  it("gives www no roles and no secret access", () => {
    const plan = planAppIam(APPS_BY_NAME.www);
    expect(plan.roles).toEqual([]);
    expect(plan.secretAccessorIds).toEqual([]);
  });

  it("secretAccessorIds matches secretsForApp", () => {
    const plan = planAppIam(APPS_BY_NAME.dashboard);
    expect(plan.secretAccessorIds.sort()).toEqual(
      secretsForApp("dashboard").map((s) => s.id).sort(),
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd infra/shared && pnpm vitest run app-iam.test.ts`
Expected: FAIL — cannot resolve `./app-iam`.

- [ ] **Step 4: Write the implementation** (`infra/shared/app-iam.ts`)

```ts
import type { AppDescriptor } from "./apps.manifest";
import { secretsForApp } from "./secret-catalog";

export interface AppIamPlan {
  app: string;
  roles: string[];
  secretAccessorIds: string[];
}

export function planAppIam(app: AppDescriptor): AppIamPlan {
  const roles: string[] = [];
  if (app.needsDb) roles.push("roles/cloudsql.client");
  if (app.needsPubsub || app.worker) {
    roles.push("roles/pubsub.publisher", "roles/pubsub.subscriber");
  }
  if (app.needsStorage) roles.push("roles/storage.objectAdmin");
  return {
    app: app.name,
    roles,
    secretAccessorIds: secretsForApp(app.name).map((s) => s.id),
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd infra/shared && pnpm vitest run app-iam.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infra/shared/apps.manifest.ts infra/shared/app-iam.ts infra/shared/app-iam.test.ts
git commit -m "feat(infra): derive per-app gcp iam from manifest + secret catalog"
```

## Task 4: Compliance mode resolution (`infra/shared/compliance.ts`)

**Files:**
- Create: `infra/shared/compliance.test.ts`
- Create: `infra/shared/compliance.ts`

- [ ] **Step 1: Write the failing test** (`infra/shared/compliance.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { resolveCompliance } from "./compliance";

describe("resolveCompliance", () => {
  it("none disables every control", () => {
    const c = resolveCompliance("none");
    expect(c).toMatchObject({
      auditLogs: false,
      immutableLogSink: false,
      cmek: false,
      orgPolicies: false,
      binaryAuthorization: false,
      cloudArmor: false,
      vpcServiceControls: false,
      logRetentionDays: 0,
    });
  });

  it("hipaa enables all controls with 2190-day retention", () => {
    const c = resolveCompliance("hipaa");
    expect(c.auditLogs).toBe(true);
    expect(c.immutableLogSink).toBe(true);
    expect(c.cmek).toBe(true);
    expect(c.orgPolicies).toBe(true);
    expect(c.logRetentionDays).toBe(2190);
  });

  it("soc2 uses 365-day retention", () => {
    expect(resolveCompliance("soc2").logRetentionDays).toBe(365);
  });

  it("hipaa+soc2 takes the longer retention", () => {
    expect(resolveCompliance("hipaa+soc2").logRetentionDays).toBe(2190);
  });

  it("overrides.logRetentionDays wins", () => {
    expect(resolveCompliance("soc2", { logRetentionDays: 730 }).logRetentionDays).toBe(730);
  });

  it("vpcServiceControls defaults off even when compliant, opt-in via override", () => {
    expect(resolveCompliance("hipaa").vpcServiceControls).toBe(false);
    expect(resolveCompliance("hipaa", { vpcServiceControls: true }).vpcServiceControls).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd infra/shared && pnpm vitest run compliance.test.ts`
Expected: FAIL — cannot resolve `./compliance`.

- [ ] **Step 3: Write the implementation** (`infra/shared/compliance.ts`)

```ts
export type ComplianceMode = "none" | "hipaa" | "soc2" | "hipaa+soc2";

export interface ComplianceConfig {
  mode: ComplianceMode;
  auditLogs: boolean;
  immutableLogSink: boolean;
  logRetentionDays: number;
  cmek: boolean;
  orgPolicies: boolean;
  binaryAuthorization: boolean;
  cloudArmor: boolean;
  vpcServiceControls: boolean;
}

const HIPAA_RETENTION = 2190; // ~6 years
const SOC2_RETENTION = 365; // ~1 year

function baseRetention(mode: ComplianceMode): number {
  switch (mode) {
    case "none":
      return 0;
    case "soc2":
      return SOC2_RETENTION;
    case "hipaa":
      return HIPAA_RETENTION;
    case "hipaa+soc2":
      return Math.max(HIPAA_RETENTION, SOC2_RETENTION);
  }
}

export function resolveCompliance(
  mode: ComplianceMode,
  overrides: { logRetentionDays?: number; vpcServiceControls?: boolean } = {},
): ComplianceConfig {
  const enabled = mode !== "none";
  return {
    mode,
    auditLogs: enabled,
    immutableLogSink: enabled,
    logRetentionDays: overrides.logRetentionDays ?? baseRetention(mode),
    cmek: enabled,
    orgPolicies: enabled,
    binaryAuthorization: enabled,
    cloudArmor: enabled,
    vpcServiceControls: overrides.vpcServiceControls ?? false,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd infra/shared && pnpm vitest run compliance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/shared/compliance.ts infra/shared/compliance.test.ts
git commit -m "feat(infra): add compliance mode resolution"
```

## Task 5: Preflight validation (`infra/shared/preflight.ts`)

**Files:**
- Create: `infra/shared/preflight.test.ts`
- Create: `infra/shared/preflight.ts`

- [ ] **Step 1: Write the failing test** (`infra/shared/preflight.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { runPreflight, type PreflightInput } from "./preflight";

const ok: PreflightInput = {
  authenticated: true,
  billingLinked: true,
  projectExists: true,
  stateBucketReachable: true,
  config: { "gcp:project": "p", "gcp:region": "us-central1" },
  requiredKeys: ["gcp:project", "gcp:region"],
};

describe("runPreflight", () => {
  it("passes when all preconditions hold", () => {
    expect(runPreflight(ok)).toEqual({ ok: true, errors: [] });
  });

  it("fails on missing auth", () => {
    const r = runPreflight({ ...ok, authenticated: false });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /authenticat/i.test(e))).toBe(true);
  });

  it("fails on unlinked billing", () => {
    expect(runPreflight({ ...ok, billingLinked: false }).errors.some((e) => /billing/i.test(e))).toBe(true);
  });

  it("fails on missing project", () => {
    expect(runPreflight({ ...ok, projectExists: false }).errors.some((e) => /project/i.test(e))).toBe(true);
  });

  it("fails on unreachable state bucket", () => {
    expect(runPreflight({ ...ok, stateBucketReachable: false }).errors.some((e) => /state bucket/i.test(e))).toBe(true);
  });

  it("fails listing each missing required config key", () => {
    const r = runPreflight({ ...ok, config: { "gcp:project": "p" } });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("gcp:region"))).toBe(true);
  });

  it("aggregates multiple errors", () => {
    const r = runPreflight({ ...ok, authenticated: false, billingLinked: false });
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd infra/shared && pnpm vitest run preflight.test.ts`
Expected: FAIL — cannot resolve `./preflight`.

- [ ] **Step 3: Write the implementation** (`infra/shared/preflight.ts`)

```ts
export interface PreflightInput {
  authenticated: boolean;
  billingLinked: boolean;
  projectExists: boolean;
  stateBucketReachable: boolean;
  config: Record<string, string | undefined>;
  requiredKeys: readonly string[];
}

export interface PreflightResult {
  ok: boolean;
  errors: string[];
}

export function runPreflight(input: PreflightInput): PreflightResult {
  const errors: string[] = [];
  if (!input.authenticated) {
    errors.push("Not authenticated to GCP. Run `gcloud auth application-default login`.");
  }
  if (!input.billingLinked) {
    errors.push("Billing is not linked to the target project. Link it in the GCP console.");
  }
  if (!input.projectExists) {
    errors.push("Target GCP project does not exist. Create it before deploying.");
  }
  if (!input.stateBucketReachable) {
    errors.push("Pulumi state bucket is unreachable. Run the state bucket pre-step.");
  }
  for (const key of input.requiredKeys) {
    if (!input.config[key]) {
      errors.push(`Missing required Pulumi config key: ${key}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd infra/shared && pnpm vitest run preflight.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/shared/preflight.ts infra/shared/preflight.test.ts
git commit -m "feat(infra): add pure preflight validation"
```

## Task 6: API enablement module (`infra/gcp/bootstrap/apis.ts`)

**Files:**
- Create: `infra/gcp/bootstrap/apis.ts`

- [ ] **Step 1: Write the implementation** (`infra/gcp/bootstrap/apis.ts`)

```ts
import * as gcp from "@pulumi/gcp";

/** Every API any layer needs, enabled up-front in bootstrap. */
export const REQUIRED_APIS: readonly string[] = [
  "cloudresourcemanager.googleapis.com",
  "serviceusage.googleapis.com",
  "iam.googleapis.com",
  "iamcredentials.googleapis.com",
  "sts.googleapis.com",
  "compute.googleapis.com",
  "run.googleapis.com",
  "sqladmin.googleapis.com",
  "pubsub.googleapis.com",
  "secretmanager.googleapis.com",
  "artifactregistry.googleapis.com",
  "vpcaccess.googleapis.com",
  "servicenetworking.googleapis.com",
  "redis.googleapis.com",
  "cloudkms.googleapis.com",
  "monitoring.googleapis.com",
  "logging.googleapis.com",
  "certificatemanager.googleapis.com",
  "binaryauthorization.googleapis.com",
  "orgpolicy.googleapis.com",
  "essentialcontacts.googleapis.com",
  "billingbudgets.googleapis.com",
  "cloudbilling.googleapis.com",
];

/**
 * Enables every required API. Returns the Service resources so other resources
 * can `dependsOn` them and never race a not-yet-active API.
 */
export function enableApis(project: string): gcp.projects.Service[] {
  return REQUIRED_APIS.map(
    (api) =>
      new gcp.projects.Service(`api-${api.split(".")[0]}`, {
        project,
        service: api,
        disableOnDestroy: false,
        disableDependentServices: false,
      }),
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd infra/gcp/bootstrap && pnpm install && npx tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add infra/gcp/bootstrap/apis.ts
git commit -m "feat(infra): bootstrap api enablement module"
```

## Task 7: Bootstrap entrypoint — APIs, VPC, Artifact Registry, deploy SA/WIF, budget

**Files:**
- Create: `infra/gcp/bootstrap/index.ts`

- [ ] **Step 1: Write the implementation** (`infra/gcp/bootstrap/index.ts`)

```ts
import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { enableApis } from "./apis";

const config = new pulumi.Config();
const gcpConfig = new pulumi.Config("gcp");
const project = gcpConfig.require("project");
const region = gcpConfig.require("region");

const privateNetwork = config.getBoolean("privateNetwork") ?? false;
const vpcCidr = config.get("vpcCidr") ?? "10.10.0.0/24";
const complianceMode = config.get("complianceMode") ?? "none";
const budgetAmount = config.get("budgetAmount");
const billingAccountId = config.get("billingAccountId");

// --- 1. Enable all APIs first; everything else dependsOn these. ---------------
const apis = enableApis(project);

// --- 2. VPC + connector + private services access (when privateNetwork). ------
const network = privateNetwork
  ? new gcp.compute.Network("starter-vpc", { autoCreateSubnetworks: false }, { dependsOn: apis })
  : undefined;

const subnet = network
  ? new gcp.compute.Subnetwork("starter-subnet", {
      network: network.id,
      region,
      ipCidrRange: vpcCidr,
      privateIpGoogleAccess: true,
    })
  : undefined;

const vpcConnector = network
  ? new gcp.vpcaccess.Connector("starter-connector", {
      region,
      network: network.name,
      ipCidrRange: "10.20.0.0/28",
      minThroughput: 200,
      maxThroughput: 300,
    })
  : undefined;

const psaRange = network
  ? new gcp.compute.GlobalAddress("starter-psa", {
      purpose: "VPC_PEERING",
      addressType: "INTERNAL",
      prefixLength: 16,
      network: network.id,
    })
  : undefined;

const psa =
  network && psaRange
    ? new gcp.servicenetworking.Connection("starter-psa-conn", {
        network: network.id,
        service: "servicenetworking.googleapis.com",
        reservedPeeringRanges: [psaRange.name],
      })
    : undefined;

// --- 3. Artifact Registry repository for app images. --------------------------
const repo = new gcp.artifactregistry.Repository(
  "starter-images",
  {
    location: region,
    repositoryId: "starter",
    format: "DOCKER",
    description: "Container images for the SaaS starter apps",
  },
  { dependsOn: apis },
);

// --- 4. Deploy service account + Workload Identity Federation. ----------------
const deploySa = new gcp.serviceaccount.Account(
  "deploy-sa",
  {
    accountId: "github-deploy",
    displayName: "GitHub Actions deploy identity",
  },
  { dependsOn: apis },
);

const DEPLOY_ROLES = [
  "roles/run.admin",
  "roles/cloudsql.client",
  "roles/artifactregistry.writer",
  "roles/secretmanager.admin",
  "roles/iam.serviceAccountUser",
];

DEPLOY_ROLES.forEach((role, i) => {
  new gcp.projects.IAMMember(`deploy-sa-role-${i}`, {
    project,
    role,
    member: pulumi.interpolate`serviceAccount:${deploySa.email}`,
  });
});

const wifPool = new gcp.iam.WorkloadIdentityPool(
  "github-pool",
  { workloadIdentityPoolId: "github", displayName: "GitHub Actions" },
  { dependsOn: apis },
);

const wifProvider = new gcp.iam.WorkloadIdentityPoolProvider("github-provider", {
  workloadIdentityPoolId: wifPool.workloadIdentityPoolId,
  workloadIdentityPoolProviderId: "github",
  displayName: "GitHub OIDC",
  attributeMapping: {
    "google.subject": "assertion.sub",
    "attribute.repository": "assertion.repository",
  },
  oidc: { issuerUri: "https://token.actions.githubusercontent.com" },
});

// --- 5. Billing budget (only when a billing account id is provided). ----------
if (billingAccountId && budgetAmount) {
  new gcp.billing.Budget(
    "starter-budget",
    {
      billingAccount: billingAccountId,
      displayName: pulumi.interpolate`starter-budget-${pulumi.getStack()}`,
      budgetFilter: { projects: [pulumi.interpolate`projects/${project}`] },
      amount: { specifiedAmount: { currencyCode: "USD", units: budgetAmount } },
      thresholdRules: [
        { thresholdPercent: 0.2 },
        { thresholdPercent: 0.5 },
        { thresholdPercent: 1.0 },
      ],
    },
    { dependsOn: apis },
  );
}

// --- Exports (locked contract — see plan header). -----------------------------
export const projectId = project;
export const regionOut = region;
export const networkId = network ? network.id : pulumi.output("");
export const networkSelfLink = network ? network.selfLink : pulumi.output("");
export const subnetSelfLink = subnet ? subnet.selfLink : pulumi.output("");
export const vpcConnectorId = vpcConnector ? vpcConnector.id : pulumi.output("");
export const privateServicesConnection = psa ? psa.id : pulumi.output("");
export const artifactRegistryRepo = pulumi.interpolate`${region}-docker.pkg.dev/${project}/${repo.repositoryId}`;
export const deployServiceAccountEmail = deploySa.email;
export const workloadIdentityProvider = wifProvider.name;
export const complianceModeOut = complianceMode;
```

- [ ] **Step 2: Type-check**

Run: `cd infra/gcp/bootstrap && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add infra/gcp/bootstrap/index.ts
git commit -m "feat(infra): bootstrap layer (apis, vpc, artifact registry, deploy wif, budget)"
```

## Task 8: L2 Pulumi mock test for `bootstrap`

**Files:**
- Create: `infra/gcp/bootstrap/bootstrap.mock.test.ts`

- [ ] **Step 1: Write the test** (`infra/gcp/bootstrap/bootstrap.mock.test.ts`)

```ts
import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";

describe("bootstrap layer (mocked)", () => {
  let infra: typeof import("./index");

  beforeAll(async () => {
    pulumi.runtime.setMocks(
      {
        newResource: (args) => ({
          id: `${args.name}-id`,
          state: { ...args.inputs, name: args.inputs.name ?? args.name },
        }),
        call: (args) => args.inputs,
      },
      "starter-gcp-bootstrap",
      "sandbox",
    );
    // sandbox stack → privateNetwork false → network outputs are "".
    process.env.PULUMI_CONFIG = JSON.stringify({
      "gcp:project": "test-project",
      "gcp:region": "us-central1",
    });
    infra = await import("./index");
  });

  it("exports an Artifact Registry repo path for the project", async () => {
    const repo = await new Promise<string>((res) => infra.artifactRegistryRepo.apply(res));
    expect(repo).toContain("test-project");
    expect(repo).toContain("docker.pkg.dev");
  });

  it("exposes empty network outputs in sandbox (privateNetwork off)", async () => {
    const net = await new Promise<string>((res) => infra.networkId.apply(res));
    expect(net).toBe("");
  });

  it("exports a deploy service account email", async () => {
    const email = await new Promise<string>((res) => infra.deployServiceAccountEmail.apply(res));
    expect(email).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd infra/gcp/bootstrap && pnpm install && pnpm vitest run bootstrap.mock.test.ts`
Expected: PASS. If config injection via `PULUMI_CONFIG` does not resolve, set config through `pulumi.runtime.setAllConfig({ "gcp:project": "test-project", "gcp:region": "us-central1" })` before importing `./index`, and re-run.

- [ ] **Step 3: Commit**

```bash
git add infra/gcp/bootstrap/bootstrap.mock.test.ts
git commit -m "test(infra): pulumi mock test for bootstrap layer"
```

## Task 9: Extend CrossGuard with least-privilege validators

**Files:**
- Modify: `infra/shared/policies/gcp-sandbox-validators.ts`
- Modify: `infra/shared/policies/gcp-sandbox.ts`
- Modify: `infra/shared/policies/gcp-sandbox.test.ts`

- [ ] **Step 1: Add failing tests** to `gcp-sandbox.test.ts`

```ts
import {
  noAllUsersOnNonPublicService,
  noPrimitiveRolesOnRuntimeSa,
} from "./gcp-sandbox-validators";

describe("noAllUsersOnNonPublicService", () => {
  it("flags allUsers invoker on a worker service binding", () => {
    const report = vi.fn();
    noAllUsersOnNonPublicService(
      "gcp:cloudrunv2/serviceIamMember:ServiceIamMember",
      { name: "starter-workers", member: "allUsers" },
      ["starter-workers"],
      report,
    );
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("allows allUsers invoker on a public service", () => {
    const report = vi.fn();
    noAllUsersOnNonPublicService(
      "gcp:cloudrunv2/serviceIamMember:ServiceIamMember",
      { name: "starter-www", member: "allUsers" },
      ["starter-workers"],
      report,
    );
    expect(report).not.toHaveBeenCalled();
  });
});

describe("noPrimitiveRolesOnRuntimeSa", () => {
  it("flags roles/owner bound to a member", () => {
    const report = vi.fn();
    noPrimitiveRolesOnRuntimeSa(
      "gcp:projects/iAMMember:IAMMember",
      { role: "roles/owner", member: "serviceAccount:x@y.iam" },
      report,
    );
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("allows a scoped role", () => {
    const report = vi.fn();
    noPrimitiveRolesOnRuntimeSa(
      "gcp:projects/iAMMember:IAMMember",
      { role: "roles/cloudsql.client", member: "serviceAccount:x@y.iam" },
      report,
    );
    expect(report).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd infra/shared/policies && pnpm vitest run`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Add validators** to `gcp-sandbox-validators.ts`

```ts
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
```

- [ ] **Step 4: Register policies** in `gcp-sandbox.ts` (add to the `policies` array)

```ts
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
        ["starter-workers"],
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
```

Add the imports at the top of `gcp-sandbox.ts`:

```ts
import {
  noGlobalForwardingRulesInSandbox,
  maxInstanceCountSandboxCap,
  noAllUsersOnNonPublicService,
  noPrimitiveRolesOnRuntimeSa,
} from "./gcp-sandbox-validators";
```

- [ ] **Step 5: Run to verify pass**

Run: `cd infra/shared/policies && pnpm vitest run`
Expected: PASS (existing + new tests).

- [ ] **Step 6: Commit**

```bash
git add infra/shared/policies/
git commit -m "feat(infra): crossguard least-privilege validators"
```

## Task 10: Wire shared-module tests into the infra test runner

**Files:**
- Create: `infra/shared/vitest.config.ts`
- Create: `infra/shared/package.json` (only if `infra/shared` has no package.json/vitest resolution yet)

- [ ] **Step 1: Verify whether `infra/shared` already has a test runner**

Run: `ls infra/shared/package.json infra/shared/vitest.config.ts 2>/dev/null; ls infra/shared/*.test.ts`
Expected: existing `env-manifest.test.ts` and `queue-profiles.test.ts` are present; note whether a `package.json`/`vitest.config.ts` exists at `infra/shared/`.

- [ ] **Step 2: If missing, create `infra/shared/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 3: If missing, create `infra/shared/package.json`**

```json
{
  "name": "starter-infra-shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/node": "^24",
    "typescript": "^5.7",
    "vitest": "^3"
  }
}
```

- [ ] **Step 4: Run the full shared suite**

Run: `cd infra/shared && pnpm install && pnpm vitest run`
Expected: PASS — `env-manifest`, `queue-profiles`, `secret-catalog`, `app-iam`, `compliance`, `preflight` tests all green.

- [ ] **Step 5: Commit**

```bash
git add infra/shared/vitest.config.ts infra/shared/package.json
git commit -m "chore(infra): vitest runner for shared modules"
```

## Self-Review checklist (run after completing tasks)

- All five shared modules exist with passing L1 tests; `bootstrap` type-checks and passes its L2 mock test.
- The locked interface contract matches the implemented signatures exactly (later plans depend on them).
- No placeholders remain; `www` reads zero secrets and gets zero roles.

## Verification

- `cd infra/shared && pnpm vitest run`
- `cd infra/gcp/bootstrap && npx tsc --noEmit && pnpm vitest run`
- `cd infra/shared/policies && pnpm vitest run`
