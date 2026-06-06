# GCP IaC P3 — `storage` Layer Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `storage` Pulumi layer — a new standalone Pulumi project at `infra/gcp/storage/` that provisions a security-hardened GCS `uploads` bucket for app object storage (uniform bucket-level access, enforced public-access prevention, versioning, env-aware `forceDestroy`/`protect`, optional CMEK), and exports the bucket name + URL consumed by the `apps` layer.

**Architecture:** `infra/gcp/storage/` is a new standalone Pulumi project (not in the pnpm workspace), one of the six independently-deployable layers under `infra/gcp/`. It reads foundational outputs from the `bootstrap` layer via `pulumi.StackReference` (project, region, compliance mode) and exports `uploadsBucketName` + `uploadsBucketUrl`, which the `apps` layer (P6) consumes to grant per-app `roles/storage.objectAdmin` and inject the bucket name into Cloud Run env. CMEK key creation is deferred to P8 (compliance); P3 only wires an optional `kmsKeyName` config input.

**Tech Stack:** Pulumi (`@pulumi/pulumi` ^3, `@pulumi/gcp` ^8), TypeScript ^5.7, Vitest ^3.

**Design spec:** [`docs/superpowers/specs/2026-06-06-gcp-comprehensive-iac-design.md`](../specs/2026-06-06-gcp-comprehensive-iac-design.md)

---

## Layer contract (locked — consumed by `apps`/P6)

This layer reads `bootstrap` outputs via `pulumi.StackReference` (config key `starter-gcp-storage:bootstrapStackRef`) and exports the following. Do not rename without updating dependents.

**Inputs (from `bootstrap` StackReference):**

| Output read | Type | Used for |
|-------------|------|----------|
| `projectId` | string | bucket name prefix + provider project |
| `regionOut` | string | bucket `location` |
| `complianceModeOut` | string | decide whether CMEK is expected (non-`"none"` ⇒ expect `kmsKeyName`) |

> `bootstrap` also exports `networkId`, `vpcConnectorId`, `artifactRegistryRepo`, and `deployServiceAccountEmail`; the `storage` layer does not need them.

**Config inputs (this layer):**

| Config key | Type | Default | Meaning |
|------------|------|---------|---------|
| `starter-gcp-storage:bootstrapStackRef` | string | — (required) | fully-qualified `bootstrap` stack name, e.g. `org/starter-gcp-bootstrap/sandbox` |
| `starter-gcp-storage:forceDestroy` | bool | `false` | allow non-empty bucket deletion (sandbox sets `true`) |
| `starter-gcp-storage:kmsKeyName` | string | unset | optional CMEK key resource name; when set, used for `encryption.defaultKmsKeyName`. **Supplied by P8 (compliance); leave unset in P3.** |

**Exports (locked):**

| Output | Type | Consumed by |
|--------|------|-------------|
| `uploadsBucketName` | string | apps (P6) |
| `uploadsBucketUrl` | string | apps (P6) |

## File Structure

- Create: `infra/gcp/storage/package.json`
- Create: `infra/gcp/storage/Pulumi.yaml`
- Create: `infra/gcp/storage/tsconfig.json`
- Create: `infra/gcp/storage/.gitignore`
- Create: `infra/gcp/storage/Pulumi.sandbox.yaml`
- Create: `infra/gcp/storage/Pulumi.staging.yaml`
- Create: `infra/gcp/storage/Pulumi.production.yaml`
- Create: `infra/gcp/storage/index.ts` — layer entrypoint (StackReference, `uploads` bucket, exports)
- Create: `infra/gcp/storage/storage.mock.test.ts` — L2 Pulumi mock test

## Critical Tests

**Required.** Identify high-value **unit** tests before the task breakdown. See [`.ai/conventions/critical-tests-in-plans.md`](../../../.ai/conventions/critical-tests-in-plans.md).

The pure security invariants of the bucket are the high-value seam; the resource graph is validated by an L2 Pulumi mock test (`pulumi.runtime.setMocks`) plus `pulumi preview` + CrossGuard in CI, not by a real apply.

- `infra/gcp/storage/storage.mock.test.ts` (L2 Pulumi mock test): asserts the `uploads` bucket is created with `uniformBucketLevelAccess: true`, `publicAccessPrevention: "enforced"`, and `versioning.enabled: true`; that `defaultKmsKeyName` (under `encryption`) is **set only when** the `kmsKeyName` config is present and **absent/empty otherwise**; that `forceDestroy` follows the `forceDestroy` config (sandbox `true`); and that `uploadsBucketName`/`uploadsBucketUrl` are exported and contain the project id and stack name.

Avoid low-value tests. Use colocated paths only (no `__tests__/` folders).

---

## Task 1: Scaffold the `storage` Pulumi project

**Files:**
- Create: `infra/gcp/storage/package.json`
- Create: `infra/gcp/storage/Pulumi.yaml`
- Create: `infra/gcp/storage/tsconfig.json`
- Create: `infra/gcp/storage/.gitignore`
- Create: `infra/gcp/storage/Pulumi.sandbox.yaml`
- Create: `infra/gcp/storage/Pulumi.staging.yaml`
- Create: `infra/gcp/storage/Pulumi.production.yaml`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "starter-gcp-storage",
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
name: starter-gcp-storage
runtime: nodejs
description: GCS object-storage buckets (uniform bucket-level access, public-access prevention, versioning, optional CMEK)
config:
  gcp:project:
    description: GCP project ID
```

- [ ] **Step 3: Create `tsconfig.json`** (mirror `infra/gcp/bootstrap/tsconfig.json`)

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

- [ ] **Step 5: Create `Pulumi.sandbox.yaml`** (sandbox allows `forceDestroy`, no CMEK)

```yaml
config:
  gcp:project: "your-sandbox-project-id"
  gcp:region: "us-central1"
  starter-gcp-storage:bootstrapStackRef: "your-org/starter-gcp-bootstrap/sandbox"
  starter-gcp-storage:forceDestroy: "true"
  # starter-gcp-storage:kmsKeyName: ""  # supplied by P8 (compliance) when complianceMode != none
```

- [ ] **Step 6: Create `Pulumi.staging.yaml`** (no `forceDestroy`, no CMEK by default)

```yaml
config:
  gcp:project: "your-staging-project-id"
  gcp:region: "us-central1"
  starter-gcp-storage:bootstrapStackRef: "your-org/starter-gcp-bootstrap/staging"
  starter-gcp-storage:forceDestroy: "false"
  # starter-gcp-storage:kmsKeyName: ""  # supplied by P8 (compliance) when complianceMode != none
```

- [ ] **Step 7: Create `Pulumi.production.yaml`** (no `forceDestroy`, no CMEK by default)

```yaml
config:
  gcp:project: "your-prod-project-id"
  gcp:region: "us-central1"
  starter-gcp-storage:bootstrapStackRef: "your-org/starter-gcp-bootstrap/production"
  starter-gcp-storage:forceDestroy: "false"
  # starter-gcp-storage:kmsKeyName: ""  # supplied by P8 (compliance) when complianceMode != none
```

- [ ] **Step 8: Commit**

```bash
git add infra/gcp/storage/
git commit -m "chore(infra): scaffold gcp storage pulumi project"
```

## Task 2: Storage entrypoint — `uploads` bucket + exports

**Files:**
- Create: `infra/gcp/storage/index.ts`

- [ ] **Step 1: Write the implementation** (`infra/gcp/storage/index.ts`)

```ts
import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

const config = new pulumi.Config();
const gcpConfig = new pulumi.Config("gcp");
const project = gcpConfig.require("project");

// --- 1. Read foundational outputs from the bootstrap layer. -------------------
const bootstrapStackRef = config.require("bootstrapStackRef");
const bootstrap = new pulumi.StackReference(bootstrapStackRef);
const region = bootstrap.getOutput("regionOut") as pulumi.Output<string>;
// complianceModeOut is informational here: when non-"none", P8 supplies kmsKeyName.
const complianceMode = bootstrap.getOutput("complianceModeOut") as pulumi.Output<string>;

// --- 2. Per-layer config. -----------------------------------------------------
const forceDestroy = config.getBoolean("forceDestroy") ?? false;
// Optional CMEK key resource name. Unset in P3; supplied by P8 (compliance).
const kmsKeyName = config.get("kmsKeyName");
const stack = pulumi.getStack();
const isProtectedEnv = stack === "staging" || stack === "production";

// --- 3. uploads bucket (general object storage). ------------------------------
// Unique per project + env. Security hardening: uniform bucket-level access,
// enforced public-access prevention, versioning. forceDestroy is env-gated;
// protect: true guards the staging/prod bucket against accidental deletion.
const uploads = new gcp.storage.Bucket(
  "uploads",
  {
    name: pulumi.interpolate`${project}-uploads-${stack}`,
    project,
    location: region,
    uniformBucketLevelAccess: true,
    publicAccessPrevention: "enforced",
    forceDestroy,
    versioning: { enabled: true },
    // CMEK is opt-in: only set when P8 (compliance) supplies a key name.
    ...(kmsKeyName
      ? { encryption: { defaultKmsKeyName: kmsKeyName } }
      : {}),
  },
  { protect: isProtectedEnv },
);

// --- Exports (locked contract — see plan header). -----------------------------
export const uploadsBucketName = uploads.name;
export const uploadsBucketUrl = uploads.url;
// Re-export for downstream visibility / debugging (not part of the locked contract).
export const complianceModeOut = complianceMode;
```

- [ ] **Step 2: Type-check**

Run: `cd infra/gcp/storage && pnpm install && npx tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add infra/gcp/storage/index.ts
git commit -m "feat(infra): storage layer uploads bucket (ubla, pap enforced, versioning, optional cmek)"
```

## Task 3: L2 Pulumi mock test for `storage`

**Files:**
- Create: `infra/gcp/storage/storage.mock.test.ts`

This mirrors the P1 `bootstrap.mock.test.ts` pattern: `pulumi.runtime.setMocks` returns each resource's inputs as its state, the bootstrap `StackReference` outputs are mocked via the `call` handler, and config is injected before importing `./index`. Two import scenarios are exercised (no CMEK vs. CMEK) by re-importing the module with `vi.resetModules()` and different config.

- [ ] **Step 1: Write the test** (`infra/gcp/storage/storage.mock.test.ts`)

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";

type BucketState = {
  name?: string;
  uniformBucketLevelAccess?: boolean;
  publicAccessPrevention?: string;
  forceDestroy?: boolean;
  versioning?: { enabled?: boolean };
  encryption?: { defaultKmsKeyName?: string };
  url?: string;
};

const capturedBuckets: BucketState[] = [];

function installMocks() {
  pulumi.runtime.setMocks(
    {
      newResource: (args) => {
        if (args.type === "gcp:storage/bucket:Bucket") {
          const state: BucketState = {
            ...args.inputs,
            name: args.inputs.name ?? args.name,
            url: `gs://${args.inputs.name ?? args.name}`,
          };
          capturedBuckets.push(state);
          return { id: `${args.name}-id`, state };
        }
        return {
          id: `${args.name}-id`,
          state: { ...args.inputs, name: args.inputs.name ?? args.name },
        };
      },
      // StackReference outputs come back through the call handler.
      call: () => ({
        outputs: {
          projectId: "test-project",
          regionOut: "us-central1",
          complianceModeOut: "none",
        },
      }),
    },
    "starter-gcp-storage",
    "sandbox",
  );
}

async function importInfra(extraConfig: Record<string, string>) {
  vi.resetModules();
  capturedBuckets.length = 0;
  process.env.PULUMI_CONFIG = JSON.stringify({
    "gcp:project": "test-project",
    "gcp:region": "us-central1",
    "starter-gcp-storage:bootstrapStackRef":
      "test-org/starter-gcp-bootstrap/sandbox",
    "starter-gcp-storage:forceDestroy": "true",
    ...extraConfig,
  });
  installMocks();
  return import("./index");
}

function out<T>(o: pulumi.Output<T>): Promise<T> {
  return new Promise<T>((res) => o.apply(res));
}

describe("storage layer (mocked) — no CMEK", () => {
  let infra: typeof import("./index");

  beforeAll(async () => {
    infra = await importInfra({});
  });

  afterAll(() => {
    delete process.env.PULUMI_CONFIG;
  });

  it("creates a single uploads bucket", () => {
    expect(capturedBuckets.length).toBe(1);
  });

  it("enables uniform bucket-level access", () => {
    expect(capturedBuckets[0].uniformBucketLevelAccess).toBe(true);
  });

  it("enforces public access prevention", () => {
    expect(capturedBuckets[0].publicAccessPrevention).toBe("enforced");
  });

  it("enables versioning", () => {
    expect(capturedBuckets[0].versioning?.enabled).toBe(true);
  });

  it("does not set a default KMS key when kmsKeyName is unset", () => {
    expect(capturedBuckets[0].encryption?.defaultKmsKeyName).toBeFalsy();
  });

  it("uses forceDestroy from config (true in sandbox)", () => {
    expect(capturedBuckets[0].forceDestroy).toBe(true);
  });

  it("names the bucket per project + stack", () => {
    expect(capturedBuckets[0].name).toBe("test-project-uploads-sandbox");
  });

  it("exports the bucket name and url", async () => {
    const name = await out(infra.uploadsBucketName);
    const url = await out(infra.uploadsBucketUrl);
    expect(name).toBe("test-project-uploads-sandbox");
    expect(url).toContain("test-project-uploads-sandbox");
  });
});

describe("storage layer (mocked) — with CMEK", () => {
  beforeAll(async () => {
    await importInfra({
      "starter-gcp-storage:kmsKeyName":
        "projects/test-project/locations/us-central1/keyRings/r/cryptoKeys/uploads",
    });
  });

  afterAll(() => {
    delete process.env.PULUMI_CONFIG;
  });

  it("sets the default KMS key when kmsKeyName is present", () => {
    expect(capturedBuckets[0].encryption?.defaultKmsKeyName).toBe(
      "projects/test-project/locations/us-central1/keyRings/r/cryptoKeys/uploads",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd infra/gcp/storage && pnpm install && pnpm vitest run storage.mock.test.ts`
Expected: PASS. If config injection via `PULUMI_CONFIG` does not resolve, set config through `pulumi.runtime.setAllConfig({ ... })` before importing `./index` (mirroring the P1 fallback note), and re-run.

- [ ] **Step 3: Commit**

```bash
git add infra/gcp/storage/storage.mock.test.ts
git commit -m "test(infra): pulumi mock test for storage layer"
```

## Self-Review checklist (run after completing tasks)

- The `uploads` bucket has `uniformBucketLevelAccess: true`, `publicAccessPrevention: "enforced"`, and versioning enabled in every env.
- `forceDestroy` is `true` only in sandbox (config-driven); staging/prod keep `false` and the bucket resource is created with `{ protect: true }`.
- `kmsKeyName` is unset in P3; `encryption.defaultKmsKeyName` is present **only** when the config is supplied (P8 wires it for compliant envs). No KMS keys are created in P3.
- Exports match the locked contract exactly: `uploadsBucketName`, `uploadsBucketUrl`.

## Verification

- `cd infra/gcp/storage && npx tsc --noEmit`
- `cd infra/gcp/storage && pnpm vitest run`
