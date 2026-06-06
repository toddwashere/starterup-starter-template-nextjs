# GCP IaC P4 — `messaging` Layer Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `messaging` Pulumi layer at `infra/gcp/messaging/` — a standalone project that always provisions the Pub/Sub jobs topic + DLQ topic + subscription (retry + dead-letter), and a flag-gated Memorystore (Redis) cache instance — exporting a locked output contract consumed by the `apps` layer (P6).

**Architecture:** `infra/gcp/messaging/` is a new standalone Pulumi project (not in the pnpm workspace). It reads foundational outputs from the `bootstrap` layer via `pulumi.StackReference` (project, region, network) and owns the "ephemeral/replaceable" resources: Pub/Sub (the queue backend for the GCP profile) and an optional Redis cache. None of these resources use `protect` — a change to the cache/queue must never touch the durable `database`/`storage` stacks. Disabled Redis exposes empty/zero outputs that downstream layers tolerate (the empty-output pattern already used by `bootstrap`/`core`).

**Tech Stack:** Pulumi (`@pulumi/pulumi` ^3, `@pulumi/gcp` ^8), TypeScript ^5.7, Vitest ^3.

**Design spec:** [`docs/superpowers/specs/2026-06-06-gcp-comprehensive-iac-design.md`](../specs/2026-06-06-gcp-comprehensive-iac-design.md) (§1 layer table — `messaging` owns Pub/Sub + flag-gated Memorystore, no protect; §4 redis is cache-only flag-gated, queue stays Pub/Sub; §8 `enableRedis` gates resource creation, downstream tolerates empty outputs).

---

## Consumes (from `bootstrap` via StackReference — locked)

Config key `starter-gcp-messaging:bootstrapStackRef` points at the `bootstrap` stack (e.g. `org/starter-gcp-bootstrap/sandbox`). The following outputs are read:

| Output | Type | Use in `messaging` |
|--------|------|--------------------|
| `projectId` | string | provider/resource project |
| `regionOut` | string | Redis region |
| `networkId` | string (`""` = no private network) | Redis `authorizedNetwork` + `connectMode` (only when non-empty) |
| `vpcConnectorId` | string (`""`) | reserved for parity; not required by Redis here |
| `complianceModeOut` | string | reserved (CMEK wiring is a later concern; not provisioned in P4) |

## Exports (locked contract — consumed by `apps`/P6)

| Export | Type | Disabled value |
|--------|------|----------------|
| `pubsubTopicName` | string | always set |
| `pubsubSubscriptionName` | string | always set |
| `pubsubDlqTopicName` | string | always set |
| `redisHost` | string | `""` when `enableRedis` false |
| `redisPort` | number | `0` when `enableRedis` false |

`apps` (P6) consumes `pubsubTopicName` + `redisHost`/`redisPort`.

## File Structure

- Create: `infra/gcp/messaging/package.json`
- Create: `infra/gcp/messaging/Pulumi.yaml`
- Create: `infra/gcp/messaging/tsconfig.json`
- Create: `infra/gcp/messaging/.gitignore`
- Create: `infra/gcp/messaging/Pulumi.sandbox.yaml`
- Create: `infra/gcp/messaging/Pulumi.staging.yaml`
- Create: `infra/gcp/messaging/Pulumi.production.yaml`
- Create: `infra/gcp/messaging/index.ts` — layer entrypoint (StackReference, Pub/Sub, flag-gated Redis, exports)
- Create: `infra/gcp/messaging/messaging.mock.test.ts` — L2 Pulumi mock test

## Critical Tests

**Required.** High-value L2 Pulumi mock tests (`pulumi.runtime.setMocks`) asserting structural invariants. See [`.ai/conventions/critical-tests-in-plans.md`](../../../.ai/conventions/critical-tests-in-plans.md). Colocated beside the entrypoint; no `__tests__/` folders.

- `infra/gcp/messaging/messaging.mock.test.ts`:
  - **Pub/Sub always exists:** importing the layer (sandbox stack, `enableRedis` off) yields non-empty `pubsubTopicName`, `pubsubSubscriptionName`, and `pubsubDlqTopicName`, with the topic/sub/DLQ names interpolated from the stack (`jobs-…`, `jobs-sub-…`, `jobs-dlq-…`).
  - **Subscription dead-letter contract:** the subscription's `deadLetterPolicy.maxDeliveryAttempts` is `5` and its `retryPolicy` is `minimumBackoff: "5s"` / `maximumBackoff: "600s"`, asserted by capturing resource inputs in the mock `newResource` handler.
  - **Redis off → empty/zero outputs:** with `enableRedis` false (sandbox default), no `gcp:redis/instance:Instance` resource is registered and `redisHost === ""`, `redisPort === 0`.
  - **Redis on + private network → authorizedNetwork wired:** with `enableRedis` true and a non-empty `bootstrap` `networkId`, exactly one Redis instance is registered with `authorizedNetwork` set and `connectMode: "PRIVATE_SERVICE_ACCESS"`, and `redisHost`/`redisPort` resolve to non-empty/non-zero values (described as a second mock-context run; see Task 3).

---

## Task 1: Scaffold the `messaging` Pulumi project

**Files:**
- Create: `infra/gcp/messaging/package.json`
- Create: `infra/gcp/messaging/Pulumi.yaml`
- Create: `infra/gcp/messaging/tsconfig.json`
- Create: `infra/gcp/messaging/.gitignore`
- Create: `infra/gcp/messaging/Pulumi.sandbox.yaml`
- Create: `infra/gcp/messaging/Pulumi.staging.yaml`
- Create: `infra/gcp/messaging/Pulumi.production.yaml`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "starter-gcp-messaging",
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
name: starter-gcp-messaging
runtime: nodejs
description: Pub/Sub jobs topic + DLQ + subscription, and flag-gated Memorystore (Redis) cache
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

- [ ] **Step 5: Create `Pulumi.sandbox.yaml`** (Redis OFF — keep sandbox cheap)

```yaml
config:
  gcp:project: "your-sandbox-project-id"
  gcp:region: "us-central1"
  starter-gcp-messaging:bootstrapStackRef: "your-org/starter-gcp-bootstrap/sandbox"
  starter-gcp-messaging:enableRedis: "false"
  starter-gcp-messaging:redisTier: "BASIC"
  starter-gcp-messaging:redisMemorySizeGb: "1"
```

- [ ] **Step 6: Create `Pulumi.staging.yaml`** (Redis configurable; defaults BASIC)

```yaml
config:
  gcp:project: "your-staging-project-id"
  gcp:region: "us-central1"
  starter-gcp-messaging:bootstrapStackRef: "your-org/starter-gcp-bootstrap/staging"
  starter-gcp-messaging:enableRedis: "false"
  starter-gcp-messaging:redisTier: "BASIC"
  starter-gcp-messaging:redisMemorySizeGb: "1"
```

- [ ] **Step 7: Create `Pulumi.production.yaml`** (Redis configurable; HA tier when enabled)

```yaml
config:
  gcp:project: "your-prod-project-id"
  gcp:region: "us-central1"
  starter-gcp-messaging:bootstrapStackRef: "your-org/starter-gcp-bootstrap/production"
  starter-gcp-messaging:enableRedis: "false"
  starter-gcp-messaging:redisTier: "STANDARD_HA"
  starter-gcp-messaging:redisMemorySizeGb: "1"
```

- [ ] **Step 8: Commit**

```bash
git add infra/gcp/messaging/package.json infra/gcp/messaging/Pulumi.yaml infra/gcp/messaging/tsconfig.json infra/gcp/messaging/.gitignore infra/gcp/messaging/Pulumi.sandbox.yaml infra/gcp/messaging/Pulumi.staging.yaml infra/gcp/messaging/Pulumi.production.yaml
git commit -m "chore(infra): scaffold gcp messaging pulumi project"
```

## Task 2: Messaging entrypoint — Pub/Sub (always) + flag-gated Redis (`infra/gcp/messaging/index.ts`)

**Files:**
- Create: `infra/gcp/messaging/index.ts`

- [ ] **Step 1: Write the implementation** (`infra/gcp/messaging/index.ts`)

Reuse the exact Pub/Sub block from `infra/gcp/core/index.ts` (topic/DLQ/subscription names, `ackDeadlineSeconds: 60`, `retryPolicy` `5s`/`600s`, `deadLetterPolicy` `maxDeliveryAttempts: 5`). Add the flag-gated Redis instance and empty-output fallbacks (mirror the empty-string output pattern in `core`/`bootstrap`).

```ts
import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

const config = new pulumi.Config();
const gcpConfig = new pulumi.Config("gcp");
const project = gcpConfig.require("project");
const region = gcpConfig.require("region");

// --- Read foundational outputs from the bootstrap layer. ----------------------
const bootstrapStackRef = config.require("bootstrapStackRef");
const bootstrap = new pulumi.StackReference(bootstrapStackRef);

// networkId is "" when bootstrap provisioned no private network (e.g. sandbox).
const networkId = bootstrap.getOutput("networkId").apply((v) => (v as string) ?? "");

// --- Feature flag + per-stack Redis tuning. -----------------------------------
const enableRedis = config.getBoolean("enableRedis") ?? false;
const redisTier = config.get("redisTier") ?? "BASIC";
const redisMemorySizeGb = config.getNumber("redisMemorySizeGb") ?? 1;

// --- Pub/Sub (always created — queue backend for the GCP profile). ------------
// Mirrors infra/gcp/core/index.ts exactly.
const jobsTopic = new gcp.pubsub.Topic("jobs", {
  name: pulumi.interpolate`jobs-${pulumi.getStack()}`,
});

const dlqTopic = new gcp.pubsub.Topic("jobs-dlq", {
  name: pulumi.interpolate`jobs-dlq-${pulumi.getStack()}`,
});

const jobsSubscription = new gcp.pubsub.Subscription("jobs-sub", {
  name: pulumi.interpolate`jobs-sub-${pulumi.getStack()}`,
  topic: jobsTopic.name,
  ackDeadlineSeconds: 60,
  retryPolicy: {
    minimumBackoff: "5s",
    maximumBackoff: "600s",
  },
  deadLetterPolicy: {
    deadLetterTopic: dlqTopic.id,
    maxDeliveryAttempts: 5,
  },
});

// --- Memorystore (Redis) — flag-gated cache. ----------------------------------
// Off = not created (GCP can't cheaply pause Redis). When a private network is
// present, attach to it via PRIVATE_SERVICE_ACCESS; otherwise create a basic
// instance with default (DIRECT_PEERING) connectivity.
const redis = enableRedis
  ? networkId.apply((net) =>
      net
        ? new gcp.redis.Instance("starter-redis", {
            name: pulumi.interpolate`starter-cache-${pulumi.getStack()}`,
            tier: redisTier,
            memorySizeGb: redisMemorySizeGb,
            region,
            authorizedNetwork: net,
            connectMode: "PRIVATE_SERVICE_ACCESS",
          })
        : new gcp.redis.Instance("starter-redis", {
            name: pulumi.interpolate`starter-cache-${pulumi.getStack()}`,
            tier: redisTier,
            memorySizeGb: redisMemorySizeGb,
            region,
          }),
    )
  : undefined;

// --- Exports (locked contract — consumed by apps/P6). -------------------------
export const pubsubTopicName = jobsTopic.name;
export const pubsubSubscriptionName = jobsSubscription.name;
export const pubsubDlqTopicName = dlqTopic.name;

// Redis disabled → empty/zero outputs (downstream tolerates the empty-output
// pattern, same as bootstrap/core network outputs).
export const redisHost: pulumi.Output<string> = redis
  ? redis.apply((r) => r.host)
  : pulumi.output("");
export const redisPort: pulumi.Output<number> = redis
  ? redis.apply((r) => r.port)
  : pulumi.output(0);
```

Notes:
- `project` is required by config for the `gcp` provider but is not referenced directly here; keep the `const project` binding because Pulumi resolves the provider project from `gcp:project`. If `tsc` flags it as unused under `noUnusedLocals`, add a trailing `export const projectId = project;` to pin it (this is additive and does not conflict with the locked export contract).
- `gcp.redis.Instance` exposes `host` (string) and `port` (number) outputs; these feed the locked `redisHost`/`redisPort` exports.
- No `protect` on any resource — these are the replaceable cache/queue resources per spec §1/§4.

- [ ] **Step 2: Install deps + type-check**

Run: `cd infra/gcp/messaging && pnpm install && npx tsc --noEmit`
Expected: PASS (no type errors). If `project` is reported unused, apply the `export const projectId = project;` note above and re-run.

- [ ] **Step 3: Commit**

```bash
git add infra/gcp/messaging/index.ts
git commit -m "feat(infra): messaging layer (pubsub topic/dlq/subscription + flag-gated redis)"
```

## Task 3: L2 Pulumi mock test for `messaging`

**Files:**
- Create: `infra/gcp/messaging/messaging.mock.test.ts`

Mirrors P1 Task 8's mock-test pattern: `pulumi.runtime.setMocks` with a `newResource` handler that records registered resources so the test can assert which resources exist and inspect their inputs. The default run uses the `sandbox` stack with `enableRedis` off.

- [ ] **Step 1: Write the test** (`infra/gcp/messaging/messaging.mock.test.ts`)

```ts
import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";

interface RecordedResource {
  type: string;
  name: string;
  inputs: Record<string, any>;
}

const recorded: RecordedResource[] = [];

describe("messaging layer (mocked, sandbox, enableRedis off)", () => {
  let infra: typeof import("./index");

  beforeAll(async () => {
    pulumi.runtime.setMocks(
      {
        newResource: (args) => {
          recorded.push({ type: args.type, name: args.name, inputs: args.inputs });
          return {
            id: `${args.name}-id`,
            state: {
              ...args.inputs,
              name: args.inputs.name ?? args.name,
              // Redis instance computed outputs (only relevant when created).
              host: "10.0.0.3",
              port: 6379,
            },
          };
        },
        call: (args) => args.inputs,
      },
      "starter-gcp-messaging",
      "sandbox",
    );
    // Sandbox config: bootstrap ref + Redis disabled. networkId from the
    // StackReference resolves to "" in the mock (no state for the ref).
    process.env.PULUMI_CONFIG = JSON.stringify({
      "gcp:project": "test-project",
      "gcp:region": "us-central1",
      "starter-gcp-messaging:bootstrapStackRef": "test-org/starter-gcp-bootstrap/sandbox",
      "starter-gcp-messaging:enableRedis": "false",
    });
    infra = await import("./index");
  });

  it("always creates the jobs topic, DLQ, and subscription", async () => {
    const topic = await new Promise<string>((res) => infra.pubsubTopicName.apply(res));
    const sub = await new Promise<string>((res) => infra.pubsubSubscriptionName.apply(res));
    const dlq = await new Promise<string>((res) => infra.pubsubDlqTopicName.apply(res));
    expect(topic).toContain("jobs-");
    expect(sub).toContain("jobs-sub-");
    expect(dlq).toContain("jobs-dlq-");
  });

  it("configures the subscription dead-letter + retry contract", () => {
    const sub = recorded.find((r) => r.type === "gcp:pubsub/subscription:Subscription");
    expect(sub).toBeDefined();
    expect(sub!.inputs.ackDeadlineSeconds).toBe(60);
    expect(sub!.inputs.retryPolicy.minimumBackoff).toBe("5s");
    expect(sub!.inputs.retryPolicy.maximumBackoff).toBe("600s");
    expect(sub!.inputs.deadLetterPolicy.maxDeliveryAttempts).toBe(5);
  });

  it("does NOT create a Redis instance when enableRedis is off", () => {
    const redis = recorded.filter((r) => r.type === "gcp:redis/instance:Instance");
    expect(redis).toHaveLength(0);
  });

  it("exports empty/zero Redis outputs when disabled", async () => {
    const host = await new Promise<string>((res) => infra.redisHost.apply(res));
    const port = await new Promise<number>((res) => infra.redisPort.apply(res));
    expect(host).toBe("");
    expect(port).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd infra/gcp/messaging && pnpm install && pnpm vitest run messaging.mock.test.ts`
Expected: PASS (4 tests green). If config injection via `PULUMI_CONFIG` does not resolve, set config with `pulumi.runtime.setAllConfig({ "gcp:project": "test-project", "gcp:region": "us-central1", "starter-gcp-messaging:bootstrapStackRef": "test-org/starter-gcp-bootstrap/sandbox", "starter-gcp-messaging:enableRedis": "false" })` before importing `./index`, and re-run.

- [ ] **Step 3: Document the `enableRedis` ON assertion (flag-on case)**

The default run proves the Redis-off path. To assert the flag-on path (do not commit a second always-running import of `./index`; module-level Pulumi state makes re-import unreliable in one process — verify locally or in a separate test file/process), the flag-on assertions are:

- Set mock config `"starter-gcp-messaging:enableRedis": "true"` and provide a non-empty `bootstrap` `networkId`. Because the StackReference yields no real state under mocks, stub the network by configuring the mock `newResource`/`call` handlers (or `pulumi.runtime.setMocks` with a `call` that returns `{ networkId: "projects/test/global/networks/starter-vpc" }` for the `pulumi:pulumi:StackReference` read), then:
  - Assert exactly one `gcp:redis/instance:Instance` is recorded.
  - Assert its inputs include `authorizedNetwork` (non-empty) and `connectMode === "PRIVATE_SERVICE_ACCESS"`, and `tier`/`memorySizeGb` reflect config.
  - Assert `redisHost` resolves to a non-empty value and `redisPort` to a non-zero value (the mock returns `host: "10.0.0.3"`, `port: 6379`).
- Confirm the no-network flag-on case (networkId `""`) records a Redis instance **without** `authorizedNetwork`/`connectMode`.

- [ ] **Step 4: Commit**

```bash
git add infra/gcp/messaging/messaging.mock.test.ts
git commit -m "test(infra): pulumi mock test for messaging layer"
```

## Self-Review checklist (run after completing tasks)

- Pub/Sub topic, DLQ, and subscription are **always** created with the exact retry (`5s`/`600s`) and dead-letter (`maxDeliveryAttempts: 5`, `ackDeadlineSeconds: 60`) settings copied from `infra/gcp/core/index.ts`.
- Redis is created only when `enableRedis` is true; when a private network is present it uses `authorizedNetwork` + `connectMode: "PRIVATE_SERVICE_ACCESS"`.
- When Redis is disabled, `redisHost === ""` and `redisPort === 0` (empty-output pattern).
- No resource uses `protect` (replaceable cache/queue layer per spec §1/§4).
- The locked export contract is exact: `pubsubTopicName`, `pubsubSubscriptionName`, `pubsubDlqTopicName`, `redisHost`, `redisPort`.

## Verification

- `cd infra/gcp/messaging && npx tsc --noEmit`
- `cd infra/gcp/messaging && pnpm vitest run`
