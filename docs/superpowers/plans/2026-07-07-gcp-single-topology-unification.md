# GCP Single-Topology Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the GCP profile use one always-private network topology across sandbox/staging/production, shrink the staging Cloud SQL tier, and reconcile the cost docs.

**Architecture:** `bootstrap.privateNetwork` moves to the base config (always `true`), so every env provisions VPC + Serverless VPC connector + Private Services Access and a private-IP Cloud SQL. `complianceMode` keeps toggling only compliance features (unchanged). Cloud Run egresses to the internet directly (no Cloud NAT in the base). This is an infra-config + IaC change only; no app code changes.

**Tech Stack:** Pulumi (`@pulumi/gcp`), TypeScript env-config layer (`infra/shared/gcp-env-config.ts`), Vitest mock tests.

**Design spec:** [`docs/superpowers/specs/2026-07-07-gcp-single-topology-unification-design.md`](../specs/2026-07-07-gcp-single-topology-unification-design.md)

## Global Constraints

- ESM `import`/`export` only; never `require()`/`module.exports`.
- Colocated `*.mock.test.ts` beside implementation; no `__tests__/` folders.
- Never read local secret files; `.env.example` is the only env reference.
- Deploy order unchanged: `bootstrap → database → storage → messaging → secrets → apps`.
- Staging default DB tier: exactly `db-custom-1-3840`.

---

## File Structure

- Modify: `infra/gcp/config.common.ts` — set base `bootstrap.privateNetwork: true`.
- Modify: `infra/gcp/config.production.ts` — drop the now-redundant `privateNetwork: true` override.
- Modify: `infra/gcp/config.staging.ts` — add `database.tier: "db-custom-1-3840"`.
- Modify: `infra/gcp/bootstrap/index.ts` — make VPC/subnet/connector/PSA unconditional (single code path).
- Modify: `infra/gcp/bootstrap/bootstrap.mock.test.ts` — expect non-empty network outputs.
- Modify: `infra/gcp/database/database.mock.test.ts` — expect private IP in sandbox.
- Modify: `infra/shared/gcp-env-config.test.ts` — assert resolved `privateNetwork`/staging tier.
- Modify: `infra/shared/gcp-env-config.ts` — adjust the sandbox validation warning (private is now expected).
- Modify: `infra/README.md` — reconcile the GCP cost rows.

## Critical Tests

- `infra/shared/gcp-env-config.test.ts`: `privateNetwork` resolves to `true` for sandbox, staging, and production; staging `database.tier` resolves to `db-custom-1-3840`.
- `infra/gcp/bootstrap/bootstrap.mock.test.ts`: `networkId` and `vpcConnectorId` are non-empty in the sandbox stack (network always created).
- `infra/gcp/database/database.mock.test.ts`: sandbox Cloud SQL uses `ipConfiguration.ipv4Enabled === false` and a set `privateNetwork` (private IP in every env).
- `infra/gcp/bootstrap/compliance.mock.test.ts` (existing, regression): `complianceMode: "none"` still registers zero compliance resources even though the VPC now always exists — topology and compliance stay decoupled.

---

## Task 1: Always-private base config + smaller staging DB

**Files:**
- Modify: `infra/gcp/config.common.ts`
- Modify: `infra/gcp/config.production.ts`
- Modify: `infra/gcp/config.staging.ts`
- Modify: `infra/shared/gcp-env-config.ts`
- Test: `infra/shared/gcp-env-config.test.ts`

**Interfaces:**
- Consumes: `composeEnvConfig`, `defineGcpEnvConfig`, `DeepPartialGcpEnvConfig` from `infra/shared/gcp-env-config.ts`.
- Produces: resolved configs where `bootstrap.privateNetwork === true` for all envs and staging `database.tier === "db-custom-1-3840"`.

- [ ] **Step 1: Write failing test for resolved config**

Add to `infra/shared/gcp-env-config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { config as sandbox } from "../gcp/config.common";
import { config as staging } from "../gcp/config.staging";
import { config as production } from "../gcp/config.production";

describe("single-topology config", () => {
  it("enables privateNetwork in every environment", () => {
    expect(sandbox.bootstrap.privateNetwork).toBe(true);
    expect(staging.bootstrap.privateNetwork).toBe(true);
    expect(production.bootstrap.privateNetwork).toBe(true);
  });

  it("uses a smaller staging database tier", () => {
    expect(staging.database.tier).toBe("db-custom-1-3840");
    expect(staging.database.availability).toBe("ZONAL");
  });
});
```

Note: `config.common.ts` currently exports `envBaseConfig`, not `config`. If no `config` export exists there, import `envBaseConfig` and alias it: `import { envBaseConfig as config } from "../gcp/config.common";`.

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter ./infra/... test -- gcp-env-config`
Expected: FAIL — `privateNetwork` is `false` for sandbox; staging tier is `db-custom-2-7680`.

- [ ] **Step 3: Set base privateNetwork true**

In `infra/gcp/config.common.ts`, change the `envBase` bootstrap block:

```ts
  bootstrap: {
    privateNetwork: true,
    vpcCidr: "10.10.0.0/24",
    budgetAmount: 0,
    billingAccountId: "",
    githubRepo: "",
    securityContactEmail: "",
  },
```

- [ ] **Step 4: Remove redundant production override**

In `infra/gcp/config.production.ts`, delete the `privateNetwork: true` line inside `bootstrap` (keep `budgetAmount`). The base now supplies it.

- [ ] **Step 5: Shrink staging DB**

In `infra/gcp/config.staging.ts`, update the `database` override:

```ts
  database: {
    tier: "db-custom-1-3840",
    availability: "ZONAL",
    pointInTimeRecovery: false,
  },
```

- [ ] **Step 6: Update the sandbox validation warning**

In `infra/shared/gcp-env-config.ts` `validateEnvConfig`, the sandbox DB-tier warning is fine, but add clarity that private networking is expected. No behavior change required; if a warning exists asserting sandbox should be public, remove it. (Search for `privateNetwork` in warnings — none today, so no edit needed. Leave a comment above the sandbox block noting private is now the baseline.)

- [ ] **Step 7: Run tests, verify pass**

Run: `pnpm --filter ./infra/... test -- gcp-env-config`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add infra/gcp/config.common.ts infra/gcp/config.production.ts infra/gcp/config.staging.ts infra/shared/gcp-env-config.ts infra/shared/gcp-env-config.test.ts
git commit -m "feat(infra): make GCP privateNetwork the base topology and shrink staging DB"
```

---

## Task 2: Bootstrap always provisions the network

**Files:**
- Modify: `infra/gcp/bootstrap/index.ts`
- Test: `infra/gcp/bootstrap/bootstrap.mock.test.ts`

**Interfaces:**
- Consumes: `config.getBoolean("privateNetwork")` (now always `true`).
- Produces: `networkId`, `networkSelfLink`, `subnetSelfLink`, `vpcConnectorId`, `privateServicesConnection` — all non-empty outputs in every env.

- [ ] **Step 1: Update the mock test expectation**

In `infra/gcp/bootstrap/bootstrap.mock.test.ts`, set config `privateNetwork` true and invert the network assertion:

```ts
    pulumi.runtime.setAllConfig({
      "gcp:project": "test-project",
      "gcp:region": "us-central1",
      "starter-gcp-bootstrap:privateNetwork": "true",
    });
```

Replace the "empty network outputs" test:

```ts
  it("provisions network outputs in every environment", async () => {
    const net = await new Promise<string>((res) => infra.networkId.apply(res));
    const connector = await new Promise<string>((res) => infra.vpcConnectorId.apply(res));
    expect(net).not.toBe("");
    expect(connector).not.toBe("");
  });
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter ./infra/... test -- bootstrap`
Expected: FAIL — with the branch still gated, outputs may be empty unless config parsed; confirm the failure is the assertion, then proceed.

- [ ] **Step 3: Make network creation unconditional**

In `infra/gcp/bootstrap/index.ts`, remove the `privateNetwork` conditional so the VPC/subnet/connector/PSA always build. Replace the gated declarations:

```ts
// --- 2. VPC + connector + private services access (always). -------------------
const network = new gcp.compute.Network("starter-vpc", { autoCreateSubnetworks: false }, { dependsOn: apis });

const subnet = new gcp.compute.Subnetwork("starter-subnet", {
  network: network.id,
  region,
  ipCidrRange: vpcCidr,
  privateIpGoogleAccess: true,
});

const vpcConnector = new gcp.vpcaccess.Connector("starter-connector", {
  region,
  network: network.name,
  ipCidrRange: "10.20.0.0/28",
  minThroughput: 200,
  maxThroughput: 300,
});

const psaRange = new gcp.compute.GlobalAddress("starter-psa", {
  purpose: "VPC_PEERING",
  addressType: "INTERNAL",
  prefixLength: 16,
  network: network.id,
});

const psa = new gcp.servicenetworking.Connection("starter-psa-conn", {
  network: network.id,
  service: "servicenetworking.googleapis.com",
  reservedPeeringRanges: [psaRange.name],
});
```

Update the exports at the bottom to reference these unconditionally (drop the `? :` fallbacks to `pulumi.output("")`), e.g.:

```ts
export const networkId = network.id;
export const vpcConnectorId = vpcConnector.id;
export const subnetSelfLink = subnet.selfLink;
export const privateServicesConnection = psa.peering;
```

Remove the now-unused `const privateNetwork = config.getBoolean("privateNetwork") ?? false;` line (or keep the read but drop the branching). Leave any `vpcCidr` read intact.

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter ./infra/... test -- bootstrap`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/gcp/bootstrap/index.ts infra/gcp/bootstrap/bootstrap.mock.test.ts
git commit -m "feat(infra): always provision GCP VPC/connector (single topology)"
```

---

## Task 3: Cloud SQL is private in every environment

**Files:**
- Modify: `infra/gcp/database/database.mock.test.ts`
- (Verify only) `infra/gcp/database/index.ts`

**Interfaces:**
- Consumes: bootstrap `networkId` output (now always non-empty).
- Produces: Cloud SQL with `ipConfiguration.ipv4Enabled === false` and `privateNetwork` set; `dbPrivateIp` non-empty.

- [ ] **Step 1: Update the mock to supply a network and assert private IP**

In `infra/gcp/database/database.mock.test.ts`, change the StackReference mock outputs to a non-empty network and give the DB instance a private IP:

```ts
                  networkId: "projects/test-project/global/networks/starter-vpc",
                  networkSelfLink:
                    "https://www.googleapis.com/compute/v1/projects/test-project/global/networks/starter-vpc",
                  subnetSelfLink: "",
                  vpcConnectorId: "projects/test-project/locations/us-central1/connectors/starter-connector",
```

And in the `DatabaseInstance` mock return, set a private IP:

```ts
                privateIpAddress: "10.10.0.3",
```

Replace the "uses a public IP" test with:

```ts
  it("uses a private IP in every environment (bootstrap network present)", async () => {
    const inst = created.find(
      (r) => r.type === "gcp:sql/databaseInstance:DatabaseInstance",
    );
    const ipConfig = await new Promise<{ ipv4Enabled?: boolean; privateNetwork?: string }>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (res) => (pulumi.output(inst!.inputs.settings) as pulumi.Output<any>).apply((s: any) => res(s.ipConfiguration)),
    );
    expect(ipConfig.ipv4Enabled).toBe(false);
    expect(ipConfig.privateNetwork).toBeTruthy();
  });
```

Update the `dbPrivateIp` test to expect non-empty:

```ts
  it("exports a non-empty dbPrivateIp when private", async () => {
    const ip = await new Promise<string>((res) => infra.dbPrivateIp.apply(res));
    expect(ip).toBe("10.10.0.3");
  });
```

- [ ] **Step 2: Run test, verify it fails then passes**

Run: `pnpm --filter ./infra/... test -- database`
Expected: initially FAIL on old assertions; after the edits above, PASS. `infra/gcp/database/index.ts` already branches on `networkId` (`ipv4Enabled: false` when a network is present), so **no production code change is expected** — if the test still fails, inspect `index.ts` lines ~75–100 and confirm the private branch triggers for a non-empty `networkId`.

- [ ] **Step 3: Commit**

```bash
git add infra/gcp/database/database.mock.test.ts infra/gcp/database/index.ts
git commit -m "test(infra): assert GCP Cloud SQL is private in every environment"
```

---

## Task 4: Reconcile cost docs

**Files:**
- Modify: `infra/README.md`

- [ ] **Step 1: Update the profile cost table**

In `infra/README.md`, update the `gcp` row and any per-env cost notes to reflect the always-private topology and real DB-dominated floor:
- Sandbox: ~$28–35/mo (adds VPC connector; no Cloud NAT).
- Staging: ~$77/mo (smaller `db-custom-1-3840`).
- Production: ~$330–390/mo (DB `db-custom-2-7680` REGIONAL HA dominates).

Add a one-line note that both sandbox and staging now use the same private topology as production.

- [ ] **Step 2: Commit**

```bash
git add infra/README.md
git commit -m "docs(infra): reconcile GCP cost table with single-topology figures"
```

---

## Self-Review Notes

- Spec coverage: privateNetwork→base (Task 1/2), private Cloud SQL (Task 3), smaller staging DB (Task 1), cost reconciliation (Task 4), decoupled compliance regression (existing compliance.mock.test — no change needed). All spec sections covered.
- No placeholders; all edits show concrete code.
- Type consistency: exported bootstrap output names (`networkId`, `vpcConnectorId`, `subnetSelfLink`, `privateServicesConnection`) match existing consumers in `database/index.ts` and `apps/index.ts`.

## Verification (end of plan)

- `pnpm type-check`
- `pnpm lint`
- `pnpm --filter ./infra/... test`
- `pnpm infra:configure --env sandbox --print-resolved` → shows `privateNetwork: true`
- `pnpm infra:preview --env sandbox` → shows VPC/connector/PSA + private Cloud SQL
