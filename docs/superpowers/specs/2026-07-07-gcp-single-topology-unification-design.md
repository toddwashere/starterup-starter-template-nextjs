# GCP Single-Topology Unification

**Date:** 2026-07-07
**Status:** Draft

## Overview

Unify the GCP profile onto **one network topology across all environments**, to
match the decision made for the AWS App Runner profile
([`2026-07-07-aws-apprunner-deploy-profile-design.md`](./2026-07-07-aws-apprunner-deploy-profile-design.md)).

Today the GCP profile branches on `bootstrap.privateNetwork`
(`false` in `config.common.ts` → sandbox uses **public-IP** Cloud SQL and no VPC;
`true` in `config.production.ts` → private VPC + connector + private Cloud SQL).
This means sandbox never exercises the private networking that staging/production
use — the exact drift class we are eliminating.

**Change:** make the private topology **constant** — VPC + Serverless VPC Access
connector + private-IP Cloud SQL in *every* environment. `complianceMode`
continues to toggle only compliance *features* (CMEK, audit logs, immutable log
sink, org policies, Binary Authorization, Cloud Armor) via the existing
`infra/gcp/bootstrap/compliance-resources.ts` — it no longer influences topology.

Also included (per product decision): **shrink the staging database** so staging
does not inherit production's expensive tier.

### Goals

- One topology for GCP, matching AWS; sandbox mirrors prod connectivity.
- Keep the base topology cheap: no Cloud NAT in the base (Cloud Run egresses to
  the internet directly; only VPC ranges route through the connector).
- Reduce staging cost via a smaller Cloud SQL tier.
- Reconcile the `infra/README.md` cost table with real figures.

### Non-goals

- Changing the AWS profile (covered by its own spec/plan).
- Adding Cloud NAT to the base topology (it stays a compliance-gated option for
  all-egress control — see Networking).
- Altering app code (this is an infra-config + IaC change only).

---

## Networking — one topology for every environment

| Aspect | All environments (constant) | Extra when `complianceMode != none` |
|--------|-----------------------------|--------------------------------------|
| VPC + subnet | Always created | — |
| Serverless VPC connector | Always created | — |
| Private Services Access (PSA) | Always created | — |
| Cloud SQL | **Private IP only** (`ipv4Enabled: false`) | CMEK, REGIONAL HA (prod), PITR (prod) |
| Cloud Run → DB | Via connector to private IP | — |
| Internet egress (Stripe, Resend, LLMs) | **Direct** Cloud Run egress (private ranges only through connector) | Optionally route **all** egress through the VPC + **Cloud NAT** for egress control |
| Encryption in transit | TLS | Enforced |

Key point: unlike AWS App Runner (which routes *all* egress through its VPC
connector and therefore needs a NAT), Cloud Run's connector defaults to routing
**only private ranges**, so internet-bound calls leave directly. The base
topology needs **no Cloud NAT**, keeping the always-private posture inexpensive.
Cloud NAT + "all-traffic" egress is a compliance-gated add-on, symmetric with the
AWS profile's compliance-gated interface VPC endpoints.

### Implementation shape

- Move `bootstrap.privateNetwork: true` into the **base** config
  (`config.common.ts` / `envBase` in the same file) so every env inherits it.
  Remove the per-env override in `config.production.ts` (now redundant) and the
  `false` default.
- `infra/gcp/bootstrap/index.ts` currently gates the VPC/connector/PSA on
  `privateNetwork`. With the flag always true, these become unconditional; keep
  the flag readable for now but default it to `true`, or drop the branch. The
  plan will choose (drop the branch, keep a single code path — fewer states).
- `infra/gcp/database/index.ts` already selects private vs public `ipConfiguration`
  from `networkId`; with the network always present it always uses private IP.

---

## Database sizing

Staging currently inherits production's `db-custom-2-7680` (2 vCPU / 7.68 GB,
~$100/mo ZONAL). Reduce it:

| Env | Current tier | New tier | Approx. /mo |
|-----|--------------|----------|-------------|
| sandbox | `db-f1-micro` | unchanged | ~$10 |
| **staging** | `db-custom-2-7680` (ZONAL) | **`db-custom-1-3840`** (1 vCPU / 3.75 GB, ZONAL) | **~$50** |
| production | `db-custom-2-7680` (REGIONAL HA) | unchanged | ~$200 |

Set `database.tier: "db-custom-1-3840"` in `config.staging.ts` (alongside the
existing `availability: "ZONAL"`, `pointInTimeRecovery: false`). An even cheaper
`db-g1-small` (shared core, ~$25/mo) is acceptable for staging if desired, at the
cost of dedicated vCPU; the plan uses `db-custom-1-3840` as the default.

---

## Cost (indicative, low traffic, `us-central1`, single topology)

| Component | sandbox (`none`) | staging (`none`) | production (`soc2`) |
|-----------|------------------|------------------|----------------------|
| Cloud Run ×5 | ~$0–5 (scale-to-zero) | ~$10 | ~$30–60 |
| Cloud SQL | ~$10 (f1-micro) | ~$50 (`db-custom-1-3840`) | ~$200 (2-vCPU REGIONAL HA) |
| VPC connector | ~$12 | ~$12 | ~$12–18 |
| Cloud NAT | — (direct egress) | — | ~$32 (compliance all-egress) |
| HTTPS LB + Cloud Armor | — | — | ~$25–40 |
| KMS / log sink / audit | — | — | ~$15 |
| Pub/Sub + Storage + Secrets | ~$3 | ~$5 | ~$15 |
| **≈ Total** | **~$28–35/mo** | **~$77/mo** | **~$330–390/mo** |

Notes:
- Unifying adds the **VPC connector (~$12/mo)** to sandbox/staging (they
  previously ran public-IP with no VPC). No Cloud NAT in the base.
- Staging drops from ~$164 to **~$77/mo** thanks to the smaller DB.
- **`infra/README.md` reconciliation:** the current table quotes GCP production at
  ~$80–150/mo, but `db-custom-2-7680 REGIONAL` alone is ~$200/mo. Update the table
  to reflect the real DB-dominated floor (~$330–390/mo prod) and the new
  always-private sandbox/staging figures.

---

## Migration / rollout considerations

- **Existing sandbox/staging state:** if a public-IP Cloud SQL instance already
  exists in a live stack, switching to private IP changes `ipConfiguration` and
  may require the instance to be reachable only via the VPC afterward. Sequence:
  deploy `bootstrap` (VPC/connector/PSA) → then `database` (flip to private IP) →
  then `apps` (connector wired). Validate connectivity before removing any public
  access. For throwaway sandboxes, recreate rather than migrate.
- Deploy order is unchanged (`bootstrap → database → storage → messaging →
  secrets → apps`); only the sandbox/staging stacks gain the network layer.
- `pnpm infra:preview` per env should show the added VPC/connector/PSA and the
  Cloud SQL IP change before applying.

---

## Critical Tests

- `infra/gcp/bootstrap/bootstrap.mock.test.ts`: update the existing sandbox
  assertion — network outputs (`vpcConnectorId`, network id) are now **non-empty
  in every environment** (previously asserted empty when `privateNetwork` off).
- `infra/gcp/database/database.mock.test.ts`: sandbox Cloud SQL now uses
  **private IP** (`ipConfiguration.ipv4Enabled === false`,
  `privateNetwork` set) in every mode — invert the current assertion that sandbox
  has no private network.
- `infra/shared/gcp-env-config.test.ts`: `privateNetwork` resolves to `true` for
  sandbox/staging/production after moving it to base; staging `database.tier`
  resolves to `db-custom-1-3840`.
- `infra/gcp/bootstrap/compliance.mock.test.ts` (existing): `complianceMode: none`
  still creates zero compliance resources even though the network now always
  exists — proves topology and compliance are decoupled.

Colocated `*.mock.test.ts` paths only; fast Pulumi mock tests, no live applies.

## Verification

- `pnpm type-check`
- `pnpm lint`
- `pnpm --filter ./infra/... test` (bootstrap/database/env-config mock tests)
- `pnpm infra:configure --env sandbox --print-resolved` (shows `privateNetwork: true`)
- `pnpm infra:preview --env sandbox` (shows VPC/connector/PSA + private Cloud SQL)
