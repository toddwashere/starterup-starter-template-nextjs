# GCP IaC P5 — `secrets` Layer Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `secrets` Pulumi layer (`infra/gcp/secrets/`) that materializes every entry in the shared `SECRET_CATALOG` as a Secret Manager secret — auto-generating values for `generated` secrets, creating empty `placeholder` secrets — composes `DATABASE_URL` from the `database` layer's outputs and stores it as the `database-url` secret version, and exports the secret resource names so the `apps` layer (P6) can wire env references and grant per-app accessor IAM.

**Architecture:** A new standalone Pulumi project under `infra/gcp/secrets/` (not part of the pnpm workspace, like the other `infra/gcp/*` layers). It imports the single-source-of-truth modules `infra/shared/secret-catalog.ts` (locked by P1) and `infra/shared/apps.manifest.ts` directly via relative path, reads `projectId` from the `bootstrap` stack and DB connection details from the `database` stack via `pulumi.StackReference`, and exports `secretIds` + `databaseUrlSecretName`. **Per-app `roles/secretmanager.secretAccessor` IAM is granted in the `apps` layer (P6)**, where the runtime service accounts are defined — this layer only creates the Secret + SecretVersion resources and exports their names.

**Tech Stack:** Pulumi (`@pulumi/pulumi` ^3, `@pulumi/gcp` ^8, `@pulumi/random` ^4), TypeScript ^5.7, Vitest ^3.

**Design spec:** [`docs/superpowers/specs/2026-06-06-gcp-comprehensive-iac-design.md`](../specs/2026-06-06-gcp-comprehensive-iac-design.md) (§5 Secrets workflow — hybrid).

---

## Dependency Contract (locked — referenced by P6)

**Upstream StackReferences this layer reads:**

| Reference config key | Stack | Outputs consumed |
|----------------------|-------|------------------|
| `starter-gcp-secrets:bootstrapStackRef` | `bootstrap` (P1) | `projectId` |
| `starter-gcp-secrets:databaseStackRef` | `database` (P2) | `dbConnectionName`, `dbPrivateIp`, `dbName`, `dbUser`, `dbPassword` (`pulumi.secret`) |

> **Ordering resolution (do not contradict):** Runtime service accounts are created in the `apps` layer (P6), so the secret-accessor IAM bindings (`roles/secretmanager.secretAccessor`, scoped per secret per app) are granted **there**, not here. P5 creates only the `Secret` + `SecretVersion` resources and **exports their resource names** so P6 can both reference them as env vars and grant accessors. This breaks what would otherwise be a `secrets → apps → secrets` cycle.

> **Database stack output names:** This plan assumes the `database` layer (P2) exports `dbConnectionName`, `dbPrivateIp` (empty string `""` when the instance is public-only), `dbName`, `dbUser`, and `dbPassword` (wrapped in `pulumi.secret`). These mirror the names already used in `infra/gcp/core/index.ts` (`sqlConnectionName`, `dbInstance.privateIpAddress`, etc.). If P2's output names differ at implementation time, adjust the `databaseStack.getOutput(...)` keys in `index.ts` to match P2's locked exports — do not change the composition logic.

**`secrets` stack outputs (locked — consumed by P6):**

| Output | Type | Consumed by |
|--------|------|-------------|
| `secretIds` | `Record<string, pulumi.Output<string>>` — map of catalog `id` → Secret Manager resource name (`projects/.../secrets/<id>`) | apps (P6) — env wiring + accessor grants |
| `databaseUrlSecretName` | `pulumi.Output<string>` — resource name of the `database-url` secret | apps (P6) |

## File Structure

- Create: `infra/gcp/secrets/package.json`
- Create: `infra/gcp/secrets/Pulumi.yaml`
- Create: `infra/gcp/secrets/tsconfig.json` (must `include` `../../shared/*.ts` so the shared imports compile)
- Create: `infra/gcp/secrets/.gitignore`
- Create: `infra/gcp/secrets/Pulumi.sandbox.yaml`
- Create: `infra/gcp/secrets/Pulumi.staging.yaml`
- Create: `infra/gcp/secrets/Pulumi.production.yaml`
- Create: `infra/gcp/secrets/db-url.ts` — pure `DATABASE_URL` composition helper
- Create: `infra/gcp/secrets/db-url.test.ts` — L1 unit test (private + public branches)
- Create: `infra/gcp/secrets/index.ts` — layer entrypoint (iterate `SECRET_CATALOG`, compose `DATABASE_URL`, exports)
- Create: `infra/gcp/secrets/secrets.mock.test.ts` — L2 Pulumi mock test

> **Shared-import resolution (address explicitly):** `index.ts` imports `../../shared/secret-catalog` and `../../shared/apps.manifest`, which live **outside** `infra/gcp/secrets/`. Pulumi's nodejs runtime resolves TS at runtime via `ts-node`/`tsx`, but `tsc --noEmit` and Vitest must also resolve them. The chosen approach: add `"../../shared/*.ts"` to the `tsconfig.json` `include` array and import via relative paths (no copy, no re-export shim). The duplicated `db-url.ts` helper (vs. any equivalent in P2) is **intentionally** local to this Pulumi project — these non-workspace layers each own their helpers, matching the repo's existing approach (`infra/gcp/core/index.ts` inlines its own composition).

## Critical Tests

**Required.** The pure composition seam (`db-url.ts`) is unit-tested directly; the Pulumi resource graph is validated structurally with an L2 mock test (the per-catalog-entry invariants), mirroring P1 Task 8.

- `infra/gcp/secrets/db-url.test.ts`: `composeDatabaseUrl` produces the **private** form `postgresql://<user>:<pw>@<privateIp>/<db>` when `privateIp` is non-empty, and the **public/socket** form `postgresql://<user>:<pw>@/<db>?host=/cloudsql/<connectionName>` when `privateIp` is empty; password special characters are passed through unchanged (documents that callers must supply already-safe credentials).
- `infra/gcp/secrets/secrets.mock.test.ts` (L2, `pulumi.runtime.setMocks`): a `Secret` resource exists for **every** `SECRET_CATALOG` entry; every `generatedSecrets()` entry has a corresponding `SecretVersion`; **no** `placeholderSecrets()` entry has a `SecretVersion`; the `database-url` secret has a `SecretVersion`; `secretIds` exports one entry per catalog id and `databaseUrlSecretName` is defined.

Avoid low-value tests. Use colocated paths only (no `__tests__/` folders).

---

## Task 1: Scaffold the `secrets` Pulumi project

**Files:**
- Create: `infra/gcp/secrets/package.json`
- Create: `infra/gcp/secrets/Pulumi.yaml`
- Create: `infra/gcp/secrets/tsconfig.json`
- Create: `infra/gcp/secrets/.gitignore`
- Create: `infra/gcp/secrets/Pulumi.sandbox.yaml`
- Create: `infra/gcp/secrets/Pulumi.staging.yaml`
- Create: `infra/gcp/secrets/Pulumi.production.yaml`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "starter-gcp-secrets",
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
    "@pulumi/pulumi": "^3",
    "@pulumi/random": "^4"
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
name: starter-gcp-secrets
runtime: nodejs
description: Secret Manager entries (generated + placeholder) and the composed DATABASE_URL
config:
  gcp:project:
    description: GCP project ID
```

- [ ] **Step 3: Create `tsconfig.json`** (mirror `infra/gcp/core/tsconfig.json`, but include the shared modules so `../../shared/*.ts` compiles)

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
  "include": ["*.ts", "../../shared/*.ts"]
}
```

- [ ] **Step 4: Create `.gitignore`**

```
.pulumi/
node_modules/
dist/
```

- [ ] **Step 5: Create `Pulumi.sandbox.yaml`** (sandbox DB is public-only → empty `dbPrivateIp` drives the socket form)

```yaml
config:
  gcp:project: "your-sandbox-project-id"
  gcp:region: "us-central1"
  starter-gcp-secrets:bootstrapStackRef: "organization/starter-gcp-bootstrap/sandbox"
  starter-gcp-secrets:databaseStackRef: "organization/starter-gcp-database/sandbox"
```

- [ ] **Step 6: Create `Pulumi.staging.yaml`**

```yaml
config:
  gcp:project: "your-staging-project-id"
  gcp:region: "us-central1"
  starter-gcp-secrets:bootstrapStackRef: "organization/starter-gcp-bootstrap/staging"
  starter-gcp-secrets:databaseStackRef: "organization/starter-gcp-database/staging"
```

- [ ] **Step 7: Create `Pulumi.production.yaml`**

```yaml
config:
  gcp:project: "your-prod-project-id"
  gcp:region: "us-central1"
  starter-gcp-secrets:bootstrapStackRef: "organization/starter-gcp-bootstrap/production"
  starter-gcp-secrets:databaseStackRef: "organization/starter-gcp-database/production"
```

> Replace `organization` with the real Pulumi org/backend qualifier used by the other stacks (for the self-managed GCS backend the form is typically just `starter-gcp-bootstrap/<stack>`; match whatever P1/P2 use).

- [ ] **Step 8: Commit**

```bash
git add infra/gcp/secrets/package.json infra/gcp/secrets/Pulumi.yaml infra/gcp/secrets/tsconfig.json infra/gcp/secrets/.gitignore infra/gcp/secrets/Pulumi.sandbox.yaml infra/gcp/secrets/Pulumi.staging.yaml infra/gcp/secrets/Pulumi.production.yaml
git commit -m "chore(infra): scaffold gcp secrets pulumi project"
```

## Task 2: `DATABASE_URL` composition helper (TDD)

**Files:**
- Create: `infra/gcp/secrets/db-url.test.ts`
- Create: `infra/gcp/secrets/db-url.ts`

- [ ] **Step 1: Write the failing test** (`infra/gcp/secrets/db-url.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { composeDatabaseUrl } from "./db-url";

describe("composeDatabaseUrl", () => {
  it("uses the private-IP form when privateIp is non-empty", () => {
    const url = composeDatabaseUrl({
      user: "starter",
      password: "pw123",
      dbName: "starter",
      privateIp: "10.30.0.5",
      connectionName: "proj:us-central1:starter-db-production",
    });
    expect(url).toBe("postgresql://starter:pw123@10.30.0.5/starter");
  });

  it("uses the Cloud SQL socket form when privateIp is empty", () => {
    const url = composeDatabaseUrl({
      user: "starter",
      password: "pw123",
      dbName: "starter",
      privateIp: "",
      connectionName: "proj:us-central1:starter-db-sandbox",
    });
    expect(url).toBe(
      "postgresql://starter:pw123@/starter?host=/cloudsql/proj:us-central1:starter-db-sandbox",
    );
  });

  it("passes credentials through unchanged (caller supplies safe values)", () => {
    const url = composeDatabaseUrl({
      user: "starter",
      password: "abcDEF123456",
      dbName: "starter",
      privateIp: "10.30.0.5",
      connectionName: "ignored",
    });
    expect(url).toContain(":abcDEF123456@");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd infra/gcp/secrets && pnpm install && pnpm vitest run db-url.test.ts`
Expected: FAIL — cannot resolve `./db-url`.

- [ ] **Step 3: Write the implementation** (`infra/gcp/secrets/db-url.ts`)

```ts
export interface DatabaseUrlParts {
  /** DB username. */
  user: string;
  /** DB password (already URL-safe; callers pass the raw secret value). */
  password: string;
  /** Database name. */
  dbName: string;
  /** Private IP of the Cloud SQL instance; "" when the instance is public-only. */
  privateIp: string;
  /** Cloud SQL connection name (project:region:instance) for the socket form. */
  connectionName: string;
}

/**
 * Composes the Postgres connection string stored as the `database-url` secret.
 *
 * - Private networking (privateIp present): direct TCP via the VPC.
 * - Public/sandbox (privateIp empty): Cloud SQL Auth Proxy unix socket mounted
 *   by Cloud Run at /cloudsql/<connectionName>.
 *
 * Pure function over plain strings so it is unit-testable; callers `apply`
 * the database stack's secret outputs before invoking it.
 */
export function composeDatabaseUrl(parts: DatabaseUrlParts): string {
  const { user, password, dbName, privateIp, connectionName } = parts;
  if (privateIp.length > 0) {
    return `postgresql://${user}:${password}@${privateIp}/${dbName}`;
  }
  return `postgresql://${user}:${password}@/${dbName}?host=/cloudsql/${connectionName}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd infra/gcp/secrets && pnpm vitest run db-url.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/gcp/secrets/db-url.ts infra/gcp/secrets/db-url.test.ts
git commit -m "feat(infra): database-url composition helper for secrets layer"
```

## Task 3: Secrets layer entrypoint (`infra/gcp/secrets/index.ts`)

**Files:**
- Create: `infra/gcp/secrets/index.ts`

- [ ] **Step 1: Write the implementation** (`infra/gcp/secrets/index.ts`)

This iterates `SECRET_CATALOG`: it creates a `Secret` for every entry; for `generated` secrets it attaches a `RandomPassword`-backed `SecretVersion`; for `placeholder` secrets it creates **no** `SecretVersion`. The `database-url` secret is special-cased: its value is the composed connection string from the `database` stack (not a random password), even though it is classified `generated`.

```ts
import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as random from "@pulumi/random";
import {
  SECRET_CATALOG,
  generatedSecrets,
  placeholderSecrets,
  secretsForApp,
} from "../../shared/secret-catalog";
import { APPS } from "../../shared/apps.manifest";
import { composeDatabaseUrl } from "./db-url";

// `secretsForApp` / `APPS` are intentionally referenced so this layer stays in
// lockstep with the shared catalog; the per-app accessor IAM that consumes them
// is granted in the apps layer (P6), which reads the `secretIds` export below.
void secretsForApp;
void APPS;

const config = new pulumi.Config();

// --- Upstream stacks ---------------------------------------------------------
const bootstrapStack = new pulumi.StackReference(config.require("bootstrapStackRef"));
const databaseStack = new pulumi.StackReference(config.require("databaseStackRef"));

const projectId = bootstrapStack.getOutput("projectId") as pulumi.Output<string>;

// Database connection details (see Dependency Contract). dbPrivateIp is "" when
// the instance is public-only (sandbox), driving the Cloud SQL socket form.
const dbConnectionName = databaseStack.getOutput("dbConnectionName") as pulumi.Output<string>;
const dbPrivateIp = databaseStack.getOutput("dbPrivateIp") as pulumi.Output<string>;
const dbName = databaseStack.getOutput("dbName") as pulumi.Output<string>;
const dbUser = databaseStack.getOutput("dbUser") as pulumi.Output<string>;
const dbPassword = databaseStack.getOutput("dbPassword") as pulumi.Output<string>;

const DATABASE_URL_ID = "database-url";

// --- 1. Create a Secret for every catalog entry. -----------------------------
const secrets: Record<string, gcp.secretmanager.Secret> = {};
for (const descriptor of SECRET_CATALOG) {
  secrets[descriptor.id] = new gcp.secretmanager.Secret(descriptor.id, {
    secretId: descriptor.id,
    replication: { auto: {} },
  });
}

// --- 2. Compose DATABASE_URL and store it as the database-url version. --------
const databaseUrl = pulumi
  .all([dbUser, dbPassword, dbName, dbPrivateIp, dbConnectionName])
  .apply(([user, password, name, privateIp, connectionName]) =>
    composeDatabaseUrl({ user, password, dbName: name, privateIp, connectionName }),
  );

new gcp.secretmanager.SecretVersion(`${DATABASE_URL_ID}-v1`, {
  secret: secrets[DATABASE_URL_ID].id,
  secretData: pulumi.secret(databaseUrl),
});

// --- 3. Generated secrets (except database-url) get a random value version. ---
// Placeholder secrets get NO version — dev adds the first value out-of-band via
// `gcloud secrets versions add <id> --data-file=-`. Cloud Run referencing
// version "latest" for a placeholder WILL FAIL until that first value exists;
// this is expected and documented in the apps layer (P6).
for (const descriptor of generatedSecrets()) {
  if (descriptor.id === DATABASE_URL_ID) continue;
  const value = new random.RandomPassword(`${descriptor.id}-value`, {
    length: 32,
    special: false,
  });
  new gcp.secretmanager.SecretVersion(`${descriptor.id}-v1`, {
    secret: secrets[descriptor.id].id,
    secretData: pulumi.secret(value.result),
  });
}

// Placeholder secrets intentionally have no SecretVersion (see note above).
void placeholderSecrets;

// --- Exports (locked contract — see Dependency Contract). ---------------------
// secretIds maps each catalog id to its Secret Manager resource name; P6 reads
// this to wire env references and grant per-secret accessor IAM to app SAs.
export const secretIds: Record<string, pulumi.Output<string>> = Object.fromEntries(
  SECRET_CATALOG.map((d) => [d.id, secrets[d.id].name]),
);
export const databaseUrlSecretName = secrets[DATABASE_URL_ID].name;
export const projectIdOut = projectId;
```

- [ ] **Step 2: Type-check**

Run: `cd infra/gcp/secrets && npx tsc --noEmit`
Expected: PASS (no type errors; `../../shared/*.ts` resolves via the tsconfig `include`).

- [ ] **Step 3: Commit**

```bash
git add infra/gcp/secrets/index.ts
git commit -m "feat(infra): secrets layer (catalog secrets, generated values, database-url)"
```

## Task 4: L2 Pulumi mock test for `secrets`

**Files:**
- Create: `infra/gcp/secrets/secrets.mock.test.ts`

This mirrors P1 Task 8: it registers Pulumi mocks, captures every constructed resource via the mock `newResource`, imports `./index`, and asserts the per-catalog-entry invariants. Stack references are mocked so `getOutput` resolves to deterministic values; `dbPrivateIp` is mocked as `""` so the socket form is exercised.

- [ ] **Step 1: Write the test** (`infra/gcp/secrets/secrets.mock.test.ts`)

```ts
import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import {
  SECRET_CATALOG,
  generatedSecrets,
  placeholderSecrets,
} from "../../shared/secret-catalog";

interface Captured {
  type: string;
  name: string;
  inputs: Record<string, unknown>;
}

const captured: Captured[] = [];

describe("secrets layer (mocked)", () => {
  let infra: typeof import("./index");

  beforeAll(async () => {
    pulumi.runtime.setMocks(
      {
        newResource: (args) => {
          captured.push({ type: args.type, name: args.name, inputs: args.inputs });
          return {
            id: `${args.name}-id`,
            state: { ...args.inputs, name: args.inputs.name ?? args.name },
          };
        },
        // StackReference outputs are resolved via the `call` hook in tests; the
        // simplest reliable path is to mock the function call to return canned
        // outputs. If the @pulumi/gcp version surfaces stack outputs through
        // newResource instead, set them there. See fallback in Step 2.
        call: (args) => {
          if (args.token === "pulumi:pulumi:getResource") return args.inputs;
          return args.inputs;
        },
      },
      "starter-gcp-secrets",
      "sandbox",
    );

    pulumi.runtime.setAllConfig({
      "gcp:project": "test-project",
      "gcp:region": "us-central1",
      "starter-gcp-secrets:bootstrapStackRef": "org/starter-gcp-bootstrap/sandbox",
      "starter-gcp-secrets:databaseStackRef": "org/starter-gcp-database/sandbox",
    });

    infra = await import("./index");
  });

  it("creates a Secret resource for every SECRET_CATALOG entry", () => {
    const secretIds = captured
      .filter((c) => c.type === "gcp:secretmanager/secret:Secret")
      .map((c) => c.inputs.secretId);
    for (const d of SECRET_CATALOG) {
      expect(secretIds).toContain(d.id);
    }
  });

  it("creates a SecretVersion for every generated secret (incl. database-url)", () => {
    const versionSecretNames = captured.filter(
      (c) => c.type === "gcp:secretmanager/secretVersion:SecretVersion",
    );
    // One version per generated secret (database-url included).
    expect(versionSecretNames.length).toBe(generatedSecrets().length);
  });

  it("creates NO SecretVersion for placeholder secrets", () => {
    const versionResourceNames = captured
      .filter((c) => c.type === "gcp:secretmanager/secretVersion:SecretVersion")
      .map((c) => c.name);
    for (const d of placeholderSecrets()) {
      expect(versionResourceNames.some((n) => n.startsWith(`${d.id}-`))).toBe(false);
    }
  });

  it("exports one secretIds entry per catalog id and a databaseUrlSecretName", async () => {
    expect(Object.keys(infra.secretIds).sort()).toEqual(
      SECRET_CATALOG.map((d) => d.id).sort(),
    );
    const dbName = await new Promise<string>((res) =>
      infra.databaseUrlSecretName.apply(res),
    );
    expect(dbName).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd infra/gcp/secrets && pnpm install && pnpm vitest run secrets.mock.test.ts`
Expected: PASS.

> **Fallback if StackReference outputs do not resolve under mocks:** Some `@pulumi/pulumi` versions resolve `StackReference.getOutput` through the `call`/`invoke` path rather than `newResource`. If the import throws or outputs are `undefined`, mock the stack reference read by intercepting the `pulumi:pulumi:getResource` / `pulumi:stack:getOutput` call token in the `call` mock to return `{ projectId: "test-project", dbConnectionName: "p:r:i", dbPrivateIp: "", dbName: "starter", dbUser: "starter", dbPassword: "pw" }`, then re-run. The structural assertions (Secret per entry, version partition) do not depend on the resolved values.

- [ ] **Step 3: Commit**

```bash
git add infra/gcp/secrets/secrets.mock.test.ts
git commit -m "test(infra): pulumi mock test for secrets layer"
```

## Self-Review checklist (run after completing tasks)

- A `Secret` is created for every `SECRET_CATALOG` entry; generated secrets have a `SecretVersion`, placeholders do not.
- `database-url` is composed via `composeDatabaseUrl` (private vs socket form) and stored as a `pulumi.secret` version.
- `secretIds` exports every catalog id → Secret resource name, and `databaseUrlSecretName` is exported; **no** accessor IAM is granted here (that is P6's job).
- `../../shared/*.ts` resolves under both `tsc --noEmit` and Vitest via the tsconfig `include`.
- Placeholder-secret "no version → `version:latest` fails until populated" behavior is documented as expected.

## Verification

- `cd infra/gcp/secrets && pnpm install && npx tsc --noEmit`
- `cd infra/gcp/secrets && pnpm vitest run`
- `pulumi preview` (in `infra/gcp/secrets/`) against a sandbox stack with the CrossGuard policy pack (`policy-pack: ../../shared/policies`), after `bootstrap` and `database` have been deployed so the StackReferences resolve.
