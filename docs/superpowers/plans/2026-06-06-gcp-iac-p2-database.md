# GCP IaC P2 — `database` Layer Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the standalone `database` Pulumi layer (`infra/gcp/database/`) that provisions a Cloud SQL Postgres instance, database, user, and auto-generated password — `protect`ed against deletion — and exports the connection facts (`dbConnectionName`, `dbPrivateIp`, `dbName`, `dbUser`, `dbPassword`, `sqlInstanceName`) that the `secrets` (P5) and `apps` (P6) layers consume.

**Architecture:** `infra/gcp/database/` is a new standalone Pulumi project (not in the pnpm workspace). It reads the `bootstrap` layer's outputs via `pulumi.StackReference` and derives private-vs-public networking from whether `bootstrap`'s `networkId` output is non-empty. The DB layer carves the Cloud SQL portion out of the existing `infra/gcp/core/index.ts` monolith, reusing its proven patterns: `RandomPassword`, `DatabaseInstance` with `protect: true` + `deletionProtection: true`, `Database`, and `User`. The non-trivial `DATABASE_URL` composition logic is extracted into a pure, Vitest-tested helper (`infra/gcp/database/db-url.ts`) — the database layer itself does **not** store `DATABASE_URL`; the `secrets` layer (P5) composes and stores it from this layer's exports using this same helper.

**Tech Stack:** Pulumi (`@pulumi/pulumi` ^3, `@pulumi/gcp` ^8, `@pulumi/random` ^4), TypeScript ^5.7, Vitest ^3.

**Design spec:** [`docs/superpowers/specs/2026-06-06-gcp-comprehensive-iac-design.md`](../specs/2026-06-06-gcp-comprehensive-iac-design.md) (§1 layer table, §2 permissions, §6 deploy).

---

## Interface Contract (locked — referenced by P5 / P6)

This layer reads `bootstrap` outputs via a single `StackReference` and exports the connection facts below. Do not rename without updating dependents.

**Consumes** (from `bootstrap` via `new pulumi.StackReference(config.require("bootstrapStackRef"))`, config key `starter-gcp-database:bootstrapStackRef`):

| `bootstrap` output | Type | Used for |
|--------------------|------|----------|
| `networkId` | string (`""` = networking disabled) | derive private vs public; `privateNetwork` on the instance |
| `privateServicesConnection` | string (`""`) | documents the PSA dependency (created in `bootstrap`) |

`region` comes from `gcp:region` config (same as `infra/gcp/core`).

**Exports (locked — consumed by P5 `secrets` / P6 `apps`):**

| Output | Type | Notes |
|--------|------|-------|
| `dbConnectionName` | string | `project:region:instance`, for the Cloud SQL proxy socket |
| `dbPrivateIp` | string (`""` when public) | private IP only when `bootstrap.networkId` is non-empty |
| `dbName` | string | logical database name (`starter`) |
| `dbUser` | string | DB user name (`starter`) |
| `dbPassword` | `pulumi.secret` string | auto-generated, encrypted in state |
| `sqlInstanceName` | string | Cloud SQL instance resource name |

**`DATABASE_URL` composition (owned here as a pure helper, applied in P5):**

- Private (`bootstrap.networkId` non-empty): `postgresql://<user>:<pass>@<privateIp>/<db>`
- Public (`bootstrap.networkId` empty): `postgresql://<user>:<pass>@/<db>?host=/cloudsql/<connectionName>`

**Per-env stack matrix (locked):**

| Stack | `dbTier` | `dbVersion` | `dbAvailability` | `dbPointInTime` | IP mode (from `bootstrap.networkId`) |
|-------|----------|-------------|------------------|-----------------|--------------------------------------|
| `sandbox` | `db-f1-micro` | `POSTGRES_16` | `ZONAL` | `false` | public (networkId `""`) |
| `staging` | `db-custom-2-7680` | `POSTGRES_16` | `REGIONAL` | `true` | private (networkId set) |
| `production` | `db-custom-2-7680` | `POSTGRES_16` | `REGIONAL` | `true` | private (networkId set) |

## File Structure

- Create: `infra/gcp/database/package.json`
- Create: `infra/gcp/database/Pulumi.yaml`
- Create: `infra/gcp/database/tsconfig.json`
- Create: `infra/gcp/database/.gitignore`
- Create: `infra/gcp/database/Pulumi.sandbox.yaml`
- Create: `infra/gcp/database/Pulumi.staging.yaml`
- Create: `infra/gcp/database/Pulumi.production.yaml`
- Create: `infra/gcp/database/db-url.ts` — pure `DATABASE_URL` composition helper
- Create: `infra/gcp/database/db-url.test.ts` — L1 unit test (private vs public composition)
- Create: `infra/gcp/database/index.ts` — layer entrypoint (StackReference, RandomPassword, DatabaseInstance/Database/User, exports)
- Create: `infra/gcp/database/database.mock.test.ts` — L2 Pulumi mock test

## Critical Tests

**Required.** The Cloud SQL resource graph is validated with `pulumi preview` + CrossGuard in CI; the fast, high-value seams below are unit/mock tested in-process.

- `infra/gcp/database/db-url.test.ts` (L1, pure): `composeDatabaseUrl` returns the **private** form `postgresql://user:pass@<privateIp>/db` when `privateIp` is non-empty, and the **public** Cloud SQL socket form `postgresql://user:pass@/db?host=/cloudsql/<connectionName>` when `privateIp` is `""`; the public branch ignores any `privateIp`/the private branch ignores `connectionName`; distinct inputs (user, password, db) are interpolated into the right positions.
- `infra/gcp/database/database.mock.test.ts` (L2, `pulumi.runtime.setMocks`): in the `sandbox` stack (`bootstrap.networkId` mocked to `""`) the `DatabaseInstance` is created with `deletionProtection: true` and `ipConfiguration.ipv4Enabled: true` (public), the exported `dbPrivateIp` resolves to `""` (private IP only used when a network is present), and `dbConnectionName` / `dbName` / `dbUser` / `sqlInstanceName` resolve to non-empty values. (Note: `protect: true` is a Pulumi resource *option* and is not surfaced to `setMocks`; it is enforced in `index.ts` and verified via `npx tsc --noEmit` + review. `deletionProtection` is its observable, state-level counterpart and is asserted here.)

---

## Task 1: Scaffold the `database` Pulumi project

**Files:**
- Create: `infra/gcp/database/package.json`
- Create: `infra/gcp/database/Pulumi.yaml`
- Create: `infra/gcp/database/tsconfig.json`
- Create: `infra/gcp/database/.gitignore`
- Create: `infra/gcp/database/Pulumi.sandbox.yaml`
- Create: `infra/gcp/database/Pulumi.staging.yaml`
- Create: `infra/gcp/database/Pulumi.production.yaml`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "starter-gcp-database",
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
name: starter-gcp-database
runtime: nodejs
description: Cloud SQL Postgres instance, database, user, and generated password
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

- [ ] **Step 5: Create `Pulumi.sandbox.yaml`** (public IP, smallest tier, no PITR)

```yaml
config:
  gcp:project: "your-sandbox-project-id"
  gcp:region: "us-central1"
  starter-gcp-database:bootstrapStackRef: "organization/starter-gcp-bootstrap/sandbox"
  starter-gcp-database:dbTier: "db-f1-micro"
  starter-gcp-database:dbVersion: "POSTGRES_16"
  starter-gcp-database:dbAvailability: "ZONAL"
  starter-gcp-database:dbPointInTime: "false"
```

- [ ] **Step 6: Create `Pulumi.staging.yaml`** (private IP via bootstrap network, regional, PITR on)

```yaml
config:
  gcp:project: "your-staging-project-id"
  gcp:region: "us-central1"
  starter-gcp-database:bootstrapStackRef: "organization/starter-gcp-bootstrap/staging"
  starter-gcp-database:dbTier: "db-custom-2-7680"
  starter-gcp-database:dbVersion: "POSTGRES_16"
  starter-gcp-database:dbAvailability: "REGIONAL"
  starter-gcp-database:dbPointInTime: "true"
```

- [ ] **Step 7: Create `Pulumi.production.yaml`** (same shape as staging, prod project + stack ref)

```yaml
config:
  gcp:project: "your-prod-project-id"
  gcp:region: "us-central1"
  starter-gcp-database:bootstrapStackRef: "organization/starter-gcp-bootstrap/production"
  starter-gcp-database:dbTier: "db-custom-2-7680"
  starter-gcp-database:dbVersion: "POSTGRES_16"
  starter-gcp-database:dbAvailability: "REGIONAL"
  starter-gcp-database:dbPointInTime: "true"
```

- [ ] **Step 8: Commit**

```bash
git add infra/gcp/database/package.json infra/gcp/database/Pulumi.yaml infra/gcp/database/tsconfig.json infra/gcp/database/.gitignore infra/gcp/database/Pulumi.sandbox.yaml infra/gcp/database/Pulumi.staging.yaml infra/gcp/database/Pulumi.production.yaml
git commit -m "chore(infra): scaffold gcp database pulumi project"
```

## Task 2: `DATABASE_URL` composition helper (`infra/gcp/database/db-url.ts`)

**Files:**
- Create: `infra/gcp/database/db-url.test.ts`
- Create: `infra/gcp/database/db-url.ts`

- [ ] **Step 1: Write the failing test** (`infra/gcp/database/db-url.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { composeDatabaseUrl } from "./db-url";

const base = {
  user: "starter",
  password: "s3cret",
  dbName: "starter",
  privateIp: "",
  connectionName: "test-project:us-central1:starter-db-sandbox",
};

describe("composeDatabaseUrl", () => {
  it("uses the Cloud SQL unix-socket form when privateIp is empty (public)", () => {
    expect(composeDatabaseUrl(base)).toBe(
      "postgresql://starter:s3cret@/starter?host=/cloudsql/test-project:us-central1:starter-db-sandbox",
    );
  });

  it("uses the private-IP TCP form when privateIp is set (private)", () => {
    expect(composeDatabaseUrl({ ...base, privateIp: "10.20.0.5" })).toBe(
      "postgresql://starter:s3cret@10.20.0.5/starter",
    );
  });

  it("private branch ignores connectionName", () => {
    const url = composeDatabaseUrl({ ...base, privateIp: "10.0.0.9", connectionName: "ignored" });
    expect(url).not.toContain("cloudsql");
    expect(url).toContain("@10.0.0.9/");
  });

  it("public branch ignores privateIp value (empty only)", () => {
    const url = composeDatabaseUrl(base);
    expect(url).toContain("host=/cloudsql/");
    expect(url).not.toMatch(/@\d/);
  });

  it("interpolates user, password, and db into the right positions", () => {
    const url = composeDatabaseUrl({
      user: "alice",
      password: "pw",
      dbName: "appdb",
      privateIp: "10.0.0.1",
      connectionName: "p:r:i",
    });
    expect(url).toBe("postgresql://alice:pw@10.0.0.1/appdb");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd infra/gcp/database && pnpm install && pnpm vitest run db-url.test.ts`
Expected: FAIL — cannot resolve `./db-url`.

- [ ] **Step 3: Write the implementation** (`infra/gcp/database/db-url.ts`)

```ts
export interface DatabaseUrlParts {
  /** DB user name. */
  user: string;
  /** DB user password (plaintext; callers pass a resolved secret). */
  password: string;
  /** Logical database name. */
  dbName: string;
  /** Private IP of the instance; "" when the instance is public. */
  privateIp: string;
  /** Cloud SQL connection name (project:region:instance) for the proxy socket. */
  connectionName: string;
}

/**
 * Composes a Postgres `DATABASE_URL`.
 *
 * - Private (privateIp non-empty): direct TCP via the VPC-routed private IP.
 * - Public (privateIp ""): Cloud SQL Auth Proxy unix socket mounted at
 *   `/cloudsql/<connectionName>` (the sandbox path; no public IPv4 dialing).
 */
export function composeDatabaseUrl(parts: DatabaseUrlParts): string {
  const { user, password, dbName, privateIp, connectionName } = parts;
  if (privateIp !== "") {
    return `postgresql://${user}:${password}@${privateIp}/${dbName}`;
  }
  return `postgresql://${user}:${password}@/${dbName}?host=/cloudsql/${connectionName}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd infra/gcp/database && pnpm vitest run db-url.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/gcp/database/db-url.ts infra/gcp/database/db-url.test.ts
git commit -m "feat(infra): database-url composition helper (private vs public)"
```

## Task 3: Database layer entrypoint (`infra/gcp/database/index.ts`)

**Files:**
- Create: `infra/gcp/database/index.ts`

- [ ] **Step 1: Write the implementation** (`infra/gcp/database/index.ts`)

```ts
import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as random from "@pulumi/random";

const config = new pulumi.Config();
const gcpConfig = new pulumi.Config("gcp");
const region = gcpConfig.require("region");

// --- Read foundational outputs from the bootstrap layer. ---------------------
const bootstrap = new pulumi.StackReference(config.require("bootstrapStackRef"));
// "" when networking is disabled (sandbox). Non-empty => private IP via the VPC.
const networkId = bootstrap.getOutput("networkId");
// Created in bootstrap; documents the ordering dependency for private IP.
const privateServicesConnection = bootstrap.getOutput("privateServicesConnection");

// --- Per-stack tuning (sandbox uses smallest tier, public IP, no PITR). ------
const dbTier = config.get("dbTier") ?? "db-f1-micro";
const dbVersion = config.get("dbVersion") ?? "POSTGRES_16";
const dbAvailability = config.get("dbAvailability") ?? "ZONAL";
const dbPointInTime = config.getBoolean("dbPointInTime") ?? false;

// --- Auto-generated password (kept out of stack config; secret in state). ----
const dbPassword = new random.RandomPassword("db-password", {
  length: 32,
  special: false,
});

// --- Cloud SQL Postgres instance. --------------------------------------------
// Private vs public is derived from bootstrap.networkId: when a network is
// present we disable public IPv4 and route through the VPC; otherwise we keep a
// public IP and apps reach the instance via the Cloud SQL Auth Proxy socket.
const dbInstance = new gcp.sql.DatabaseInstance(
  "starter-db",
  {
    name: pulumi.interpolate`starter-db-${pulumi.getStack()}`,
    databaseVersion: dbVersion,
    region,
    deletionProtection: true,
    settings: {
      tier: dbTier,
      availabilityType: dbAvailability,
      backupConfiguration: {
        enabled: true,
        pointInTimeRecoveryEnabled: dbPointInTime,
      },
      ipConfiguration: networkId.apply((id) =>
        id !== ""
          ? { ipv4Enabled: false, privateNetwork: id }
          : { ipv4Enabled: true },
      ),
    },
  },
  {
    protect: true,
    deleteBeforeReplace: false,
  },
);

const database = new gcp.sql.Database("app-db", {
  instance: dbInstance.name,
  name: "starter",
});

const user = new gcp.sql.User("app-user", {
  instance: dbInstance.name,
  name: "starter",
  password: dbPassword.result,
});

// --- Exports (locked contract — consumed by secrets (P5) / apps (P6)). -------
export const sqlInstanceName = dbInstance.name;
export const dbConnectionName = dbInstance.connectionName;
// Private IP only when a VPC network is present; "" signals public mode to P5.
export const dbPrivateIp = pulumi
  .all([networkId, dbInstance.privateIpAddress])
  .apply(([id, ip]) => (id !== "" ? ip ?? "" : ""));
export const dbName = database.name;
export const dbUser = user.name;
export const dbPassword_ = pulumi.secret(dbPassword.result);
export { dbPassword_ as dbPassword };
```

- [ ] **Step 2: Type-check**

Run: `cd infra/gcp/database && npx tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add infra/gcp/database/index.ts
git commit -m "feat(infra): database layer (cloud sql instance, db, user, password)"
```

## Task 4: L2 Pulumi mock test for `database`

**Files:**
- Create: `infra/gcp/database/database.mock.test.ts`

- [ ] **Step 1: Write the test** (`infra/gcp/database/database.mock.test.ts`) — mirrors P1 Task 8's mock structure

```ts
import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";

interface Created {
  type: string;
  name: string;
  inputs: Record<string, unknown>;
}

describe("database layer (mocked)", () => {
  let infra: typeof import("./index");
  const created: Created[] = [];

  beforeAll(async () => {
    pulumi.runtime.setMocks(
      {
        newResource: (args) => {
          created.push({ type: args.type, name: args.name, inputs: args.inputs });
          // bootstrap StackReference: sandbox => networkId "" (public mode).
          if (args.type === "pulumi:pulumi:StackReference") {
            return {
              id: `${args.name}-id`,
              state: {
                outputs: {
                  projectId: "test-project",
                  regionOut: "us-central1",
                  networkId: "",
                  networkSelfLink: "",
                  subnetSelfLink: "",
                  vpcConnectorId: "",
                  privateServicesConnection: "",
                  artifactRegistryRepo:
                    "us-central1-docker.pkg.dev/test-project/starter",
                  deployServiceAccountEmail:
                    "github-deploy@test-project.iam.gserviceaccount.com",
                  complianceModeOut: "none",
                },
              },
            };
          }
          if (args.type === "gcp:sql/databaseInstance:DatabaseInstance") {
            return {
              id: `${args.name}-id`,
              state: {
                ...args.inputs,
                name: args.inputs.name ?? args.name,
                connectionName: "test-project:us-central1:starter-db-sandbox",
                privateIpAddress: "",
              },
            };
          }
          return {
            id: `${args.name}-id`,
            state: { ...args.inputs, name: args.inputs.name ?? args.name },
          };
        },
        call: (args) => args.inputs,
      },
      "starter-gcp-database",
      "sandbox",
    );
    // sandbox stack config. If PULUMI_CONFIG injection does not resolve in your
    // Pulumi version, call pulumi.runtime.setAllConfig({...}) with the same keys
    // before importing ./index, then re-run.
    process.env.PULUMI_CONFIG = JSON.stringify({
      "gcp:project": "test-project",
      "gcp:region": "us-central1",
      "starter-gcp-database:bootstrapStackRef":
        "organization/starter-gcp-bootstrap/sandbox",
      "starter-gcp-database:dbTier": "db-f1-micro",
      "starter-gcp-database:dbVersion": "POSTGRES_16",
      "starter-gcp-database:dbAvailability": "ZONAL",
      "starter-gcp-database:dbPointInTime": "false",
    });
    infra = await import("./index");
  });

  it("creates the Cloud SQL instance with deletionProtection enabled", () => {
    const inst = created.find(
      (r) => r.type === "gcp:sql/databaseInstance:DatabaseInstance",
    );
    expect(inst).toBeDefined();
    expect(inst!.inputs.deletionProtection).toBe(true);
  });

  it("uses a public IP in sandbox (bootstrap network absent)", async () => {
    const inst = created.find(
      (r) => r.type === "gcp:sql/databaseInstance:DatabaseInstance",
    );
    const ipConfig = await new Promise<{ ipv4Enabled?: boolean; privateNetwork?: string }>(
      (res) => pulumi.output(inst!.inputs.settings as never).apply((s) => res((s as { ipConfiguration: never }).ipConfiguration)),
    );
    expect(ipConfig.ipv4Enabled).toBe(true);
    expect(ipConfig.privateNetwork).toBeUndefined();
  });

  it("exports an empty dbPrivateIp when public (private IP only with a network)", async () => {
    const ip = await new Promise<string>((res) => infra.dbPrivateIp.apply(res));
    expect(ip).toBe("");
  });

  it("exports non-empty connection facts for downstream layers", async () => {
    const conn = await new Promise<string>((res) => infra.dbConnectionName.apply(res));
    const name = await new Promise<string>((res) => infra.dbName.apply(res));
    const userName = await new Promise<string>((res) => infra.dbUser.apply(res));
    const instanceName = await new Promise<string>((res) => infra.sqlInstanceName.apply(res));
    expect(conn).toContain("test-project");
    expect(name).toBe("starter");
    expect(userName).toBe("starter");
    expect(instanceName).toContain("starter-db");
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd infra/gcp/database && pnpm install && pnpm vitest run database.mock.test.ts`
Expected: PASS. If `PULUMI_CONFIG` injection does not resolve in your Pulumi version, set config via `pulumi.runtime.setAllConfig({ "gcp:project": "test-project", "gcp:region": "us-central1", "starter-gcp-database:bootstrapStackRef": "organization/starter-gcp-bootstrap/sandbox", "starter-gcp-database:dbTier": "db-f1-micro", "starter-gcp-database:dbVersion": "POSTGRES_16", "starter-gcp-database:dbAvailability": "ZONAL", "starter-gcp-database:dbPointInTime": "false" })` before `await import("./index")`, then re-run.

- [ ] **Step 3: Commit**

```bash
git add infra/gcp/database/database.mock.test.ts
git commit -m "test(infra): pulumi mock test for database layer"
```

## Self-Review checklist (run after completing tasks)

- The instance uses **both** `{ protect: true }` (resource option) and `deletionProtection: true` (input) — durable data is double-guarded.
- Private vs public is derived **only** from `bootstrap.networkId`; sandbox (empty) stays public, staging/production (set) go private with no public IPv4.
- Exports match the locked contract exactly: `dbConnectionName`, `dbPrivateIp` (`""` when public), `dbName`, `dbUser`, `dbPassword` (`pulumi.secret`), `sqlInstanceName`.
- The DB layer does **not** create a `database-url` Secret Manager entry — that belongs to P5, which composes it from these exports via `composeDatabaseUrl`.
- No placeholders remain; all code is complete; the layer type-checks and both tests pass.

## Verification

- `cd infra/gcp/database && npx tsc --noEmit`
- `cd infra/gcp/database && pnpm vitest run db-url.test.ts`
- `cd infra/gcp/database && pnpm vitest run database.mock.test.ts`
- `cd infra/gcp/database && pnpm vitest run` (full layer suite — both tests green)
- `pulumi preview` against the `sandbox` stack with the CrossGuard policy pack (`policy-pack: ../../shared/policies`)
