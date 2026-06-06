# Comprehensive GCP IaC (Pulumi)

**Date:** 2026-06-06  
**Status:** Draft

## Overview

Make the existing `infra/gcp` Pulumi setup fully turnkey. A developer manually creates the GCP project(s) and links billing; from there a **single master script** stands up everything else — or any one layer in isolation. The build covers all five apps (`dashboard`, `www`, `public-api`, `public-mcp`, `workers`) plus a relational database, and is designed to **proactively avoid the apply-fail-fix loop** (up-front API enablement, correct dependency ordering, IAM granted before dependents, and a config preflight).

It supersedes the scaffold described in `infra/gcp/README.md` (Tasks 3.1/3.2/7.1) and extends — not replaces — `infra/shared/` (`apps.manifest.ts`, `env-manifest.ts`, `queue-profiles.ts`, `policies/`).

Key decisions (from brainstorming):

- Developer creates project + billing manually; everything else is automated.
- **Separate GCP projects** per environment (staging / prod); each layer gets a Pulumi stack per env.
- **Six independently-deployable layers** so a change to one critical resource can't ripple into another.
- **Per-app runtime service accounts everywhere** (least privilege + audit attribution + blast-radius containment).
- **`complianceMode`** enum (`none | hipaa | soc2 | hipaa+soc2`), off by default, flipped per environment.
- **DNS stays external** (e.g. Namecheap); GCP owns LB / WAF / TLS / routing via a static IP.
- **Self-managed GCS Pulumi state backend** (no third-party state dependency).
- **Two pipelines:** infra = manual button-press + prod approval; app = git-triggered with a migrate gate and zero-downtime rollout.

---

## 1. Layer architecture

Six Pulumi projects under `infra/gcp/`, each with a stack per environment (`sandbox`, `staging`, `production`). Dependencies flow strictly downward via `pulumi.StackReference`. A disabled layer/feature exposes empty outputs that downstream layers tolerate (the pattern the current `core/index.ts` VPC outputs already use).

| # | Layer (dir) | Owns | Protect | Reads from |
|---|-------------|------|---------|-----------|
| 1 | `bootstrap` | API enablement; VPC + Serverless VPC connector + private services access; Artifact Registry repo; deploy SA + Workload Identity Federation; billing budget; KMS keyring + keys (compliance); Data Access audit-log config + immutable log-sink bucket (compliance); org-policy constraints (compliance) | KMS keys, log bucket | — |
| 2 | `database` | Cloud SQL instance, database, user; backups/PITR; CMEK wiring | ✅ instance | bootstrap |
| 3 | `storage` | GCS bucket(s); uniform bucket-level access; public-access prevention; CMEK wiring | ✅ buckets | bootstrap |
| 4 | `messaging` | Pub/Sub topic + DLQ + subscription; Memorystore Redis (flag-gated) | — (ephemeral) | bootstrap |
| 5 | `secrets` | Secret Manager entries (generated + placeholder); per-app IAM accessor grants | — | bootstrap, database |
| 6 | `apps` | Per-app runtime SAs; Cloud Run services (5); `migrate` Cloud Run Job; global HTTPS LB + Cloud Armor + Certificate Manager certs (flag-gated); uptime checks + alert policies | — | 1,2,3,4,5 |

**Why networking lives in `bootstrap`:** Cloud SQL (private IP), Memorystore, and Cloud Run (VPC connector) all depend on the VPC, and it changes rarely. Co-locating it with the other foundational, set-once resources avoids a seventh layer and a cross-layer network dependency cycle.

**Why DB / storage / messaging are split:** Cloud SQL and GCS are durable and catastrophic to lose, so they are isolated and `protect: true`; Pub/Sub + Redis are replaceable, so a change to the cache/queue can never touch the database stack.

### Layer dependency graph

```
bootstrap
 ├─> database ─┐
 ├─> storage ──┤
 ├─> messaging ┤
 └─> secrets ──┤
               └─> apps
```

## 2. Permissions model (the core "get ahead of it" goal)

The dominant cause of failed first applies is missing API enablement and missing IAM. We front-load both.

- **API enablement first.** `bootstrap` enables every required service (`run`, `sqladmin`, `pubsub`, `secretmanager`, `artifactregistry`, `compute`, `vpcaccess`, `servicenetworking`, `iam`, `cloudkms`, `monitoring`, `logging`, `cloudresourcemanager`, `certificatemanager`, `binaryauthorization`, `orgpolicy`, `essentialcontacts`, `billingbudgets`) with `disableDependentServices` left default and an explicit dependency edge so downstream resources never race a not-yet-active API.
- **Per-app runtime service accounts.** One SA per app, generated in the same loop that defines the Cloud Run services (driven by `apps.manifest.ts`). Each SA is granted only:
  - `roles/cloudsql.client` — apps with `needsDb`.
  - `roles/secretmanager.secretAccessor` — **scoped per secret**, only the secrets that app reads.
  - `roles/pubsub.publisher` / `roles/pubsub.subscriber` — workers only.
  - `roles/storage.objectAdmin` — scoped to the app's bucket, only apps that use storage.
  - `www` gets a near-empty SA (no DB, no secrets, no Pub/Sub).
- **Deploy identity via Workload Identity Federation.** `bootstrap` provisions the WIF pool + provider and a `deploy` SA with the minimal admin roles (`run.admin`, `cloudsql.client`, `artifactregistry.writer`, `secretmanager.admin` or narrower, `iam.serviceAccountUser`). No long-lived JSON keys; replaces the manual setup in `infra/gcp/README.md`.
- **CrossGuard enforcement.** Extend `infra/shared/policies/` to assert: no `allUsers` on non-public services, no public DB IP when `complianceMode != none`, buckets must have public-access prevention, runtime SAs must not hold project-level primitive roles (`owner`/`editor`).

## 3. complianceMode (HIPAA / SOC 2)

`complianceMode: "none" | "hipaa" | "soc2" | "hipaa+soc2"` (default `none`), set per stack. A single switch because the two frameworks share ~80% of technical controls; they differ mainly in retention and emphasis.

When enabled, bundles:

- **Data Access audit logs** via `IAMAuditConfig` (project-wide `DATA_READ`/`DATA_WRITE`).
- **Immutable log retention:** log sink → dedicated GCS bucket with Bucket Lock + locked retention policy of `logRetentionDays` (default **2190** for HIPAA, **365** for SOC 2; overridable).
- **CMEK:** Cloud KMS keyring + keys wired into Cloud SQL, GCS, and Pub/Sub.
- **Org-policy constraints:** `sql.restrictPublicIp`, `storage.publicAccessPrevention`, `iam.allowedPolicyMemberDomains`, `gcp.resourceLocations` (data residency).
- **Essential Contacts**, **Binary Authorization** on Cloud Run, **Cloud Armor** on the LB, optional **VPC Service Controls** perimeter (sub-flag, off by default).

**Out of scope (manual / non-IaC):** signing the Google BAA; the SOC 2 / HIPAA audit and evidence collection; periodic access reviews; keeping PHI out of application logs (app-level redaction).

## 4. Domains, TLS, routing

- Global external HTTPS load balancer on a **reserved static anycast IP**, with **host-based URL-map routing**: `app.` → dashboard, `api.` → public-api, `mcp.` → public-mcp, apex + `www.` → www. Workers stay internal (no ingress).
- **Cloud Armor** attached to the backend (rate limiting + common-attack rules).
- **Certificate Manager + DNS authorization** for Google-managed certs: one CNAME per domain, so certs provision independently of traffic (zero-downtime cutover).
- **DNS stays external.** No Cloud DNS managed zone. Pulumi outputs the static IP and the exact DNS-authorization CNAMEs; the developer adds a handful of A records + the auth CNAMEs at the registrar once. MX/SPF/DKIM and unrelated records remain fully decoupled from GCP.
- **Flag-gated** (`enableHttpsLb`). Sandbox defaults to raw Cloud Run URLs (no always-on LB cost). The `apps` layer's existing `enableHttpsLb` scaffolding is generalized from dashboard-only to multi-host.

## 5. Secrets workflow (hybrid)

- **Auto-generated** (Pulumi `random` → `SecretVersion`): DB password, `BETTER_AUTH_SECRET`, `CAMPAIGN_UNSUBSCRIBE_SECRET`.
- **Placeholder secrets** (created empty + IAM accessor grants; dev populates values out-of-band via `gcloud`/console): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, OAuth client secrets, AI provider keys, `SENTRY_DSN`.
- Real external keys never enter Pulumi state or stack config. The secret catalog and which app reads which secret is declared once (extends `infra/shared/`) and drives both the `secrets` layer and the per-app accessor grants in §2.

## 6. Deploy model & zero-downtime

**Two pipelines, different triggers and blast radius:**

- **Infrastructure pipeline** — the six Pulumi layers. Manual `workflow_dispatch`; production gated by a required-reviewer GitHub Environment. Never touches schema.
- **App release pipeline** — git-triggered. Build image → run `migrate` Cloud Run Job (`prisma migrate deploy`) **as a gate** → deploy new Cloud Run revision with `--no-traffic` → smoke-test health endpoint → shift traffic (100%, or canary 5%→100% optional) → done.

**Prisma rides with the app pipeline**, not infra: migrations are versioned with app code and a revision expects a schema. The `migrate` job is *defined* by IaC (reproducible) but *triggered* by the app release.

**Graceful failure:** migrate-job failure aborts the rollout (old revision keeps serving); a new revision that fails its startup probe never receives traffic; rollback is a traffic shift back to the previous immutable revision.

**Zero-downtime rules (enforced / documented):**

1. New revision deployed `--no-traffic`, gated on startup probe before any traffic.
2. **Expand/contract (parallel-change) migrations** — old and new revisions share the DB during rollout, so every migration must be backward-compatible (add nullable/new → backfill → later release drops). Candidate CI lint to flag destructive migrations.
3. **Graceful shutdown / worker drain** on SIGTERM (`terminationGracePeriodSeconds`); workers finish/ack the in-flight job before exit. *(App-level work the IaC enables.)*
4. Warm critical service (`minInstanceCount: 1` dashboard in prod — already present).
5. **Backward-compatible Pub/Sub message contracts** (at-least-once + concurrent old/new workers).
6. Retained prior revisions for instant rollback.

## 7. Master script, targeting, and state

- Replace the placeholder `pnpm infra:*` commands with a real orchestrator (all take `--env sandbox|staging|production`):
  - `infra:deploy [--env]` — runs all six layers in dependency order for the selected env.
  - `infra:deploy <layer> [--env]` — runs one layer (e.g. `database`, `secrets`).
  - `infra:preview [<layer>] [--env]` — L3 read-only diff per layer.
  - `infra:test:ephemeral` — L4: apply → smoke-test → `destroy` against a throwaway project/stack (on-demand only).
  - `infra:destroy [--env]`, `infra:init`.
- **State backend:** self-managed GCS bucket (`pulumi login gs://…`), created by a tiny idempotent pre-step before `bootstrap`, keeping all state inside the customer's GCP project.
- **Preflight check** runs before any apply: `gcloud` auth present, billing linked, target project exists, required stack config keys set, state bucket reachable. Fails fast with actionable messages — this is the primary anti-back-and-forth guard.
- Per-env config selects the target project (separate staging/prod projects).

## 8. Feature flags (enable / disable)

Small, meaningful set of config booleans gating resource creation (off = not created, since GCP can't cheaply pause Cloud SQL/Redis): `enableRedis`, `enableHttpsLb`, `enableMonitoring`, `complianceMode` (enum), and optional per-app `enabled`. Downstream layers must tolerate empty outputs from a disabled feature.

## 9. Build & test strategy

Goal: discover mistakes *before* a real apply, to avoid the apply-fail-fix loop. GCP has almost no local emulation for Cloud Run / LB / IAM, so the strategy is to push structural validation into fast in-process tests, then validate cheaply with `preview`, then optionally prove end-to-end against a disposable project.

| Level | What | Cost | Trigger |
|-------|------|------|---------|
| type-check | `tsc --noEmit` / `pnpm type-check` — typed SDK catches wrong/missing props | free | every save / commit |
| **L1** | Pure-function unit tests (secret catalog, per-app IAM derivation, compliance-config, preflight, env-manifest) | free | every commit |
| **L2** | Pulumi **mock tests** (`pulumi.runtime.setMocks`) asserting structural invariants + CrossGuard policy unit tests | free | every commit |
| **L3** | `pulumi preview` per layer against a sandbox stack with the policy pack | free (read-only API calls; no Pulumi SaaS cost on GCS backend) | every PR + on-demand |
| **L4** | Ephemeral `pulumi up` → smoke-test → `pulumi destroy` against a throwaway project/stack | real but brief (minutes of live resources) | **on-demand only (manual dispatch), not scheduled** |

- **L1/L2** catch ~80% of mistakes in-process with no cloud. Type-check first.
- **L2 invariants** (examples): worker = internal ingress; only intended services get `allUsers`; every bucket has public-access prevention; an app's SA is granted accessor on exactly its declared secrets; required `dependsOn` edges exist.
- **L3** is free and read-only (like `terraform plan`); it also surfaces "API not enabled"/auth errors before any apply. Wire it into PR CI (extends the existing `deploy-gcp.yml` preview job) and expose it via `infra:preview`.
- **L4** is mechanically a real deploy, but targets a **disposable** project/stack with dummy data, `protect: false`, smallest tiers, `complianceMode: none`, and **always tears down** at the end. Its unique value is proving clean create-from-empty **and** clean teardown (creation + destroy ordering) without risking staging/prod. Exposed as `infra:test:ephemeral` and a manual `workflow_dispatch` job — **never scheduled**, so it incurs cost only when a human runs it.

### Running real infrastructure changes (staging + prod)

The actual environment applies are the **infrastructure pipeline** from §6/§7, distinct from L4:

- `infra:deploy --env staging` / `infra:deploy --env production` runs the six layers in dependency order against the corresponding GCP project; `infra:deploy <layer> --env <env>` targets one layer.
- Manual `workflow_dispatch`; **production gated by a required-reviewer GitHub Environment**.
- Preflight (§7) runs first; `protect: true` and `complianceMode` apply per env; nothing is destroyed.
- Difference from L4: real project, real data/secrets/domains, left running, prod approval gate.

**Recommended (optional, low-cost) to kill a drift error class:** make `infra/shared/apps.manifest.ts` + the new secret catalog the single source of truth and *derive* services/SAs/IAM/env from them, removing the current duplication between `apps.manifest.ts` and `infra/gcp/apps/index.ts`. This makes the L2 mock tests authoritative.

---

## Critical Tests

**Required.** These are the pure, fast-to-test seams; Pulumi resource graphs themselves are validated via `pulumi preview` + CrossGuard in CI, not unit tests.

- `infra/shared/secret-catalog.test.ts`: the secret catalog maps each app to exactly the secrets it reads; generated vs. placeholder secrets are correctly classified; no app is granted accessor on a secret it doesn't declare (drives §2 least-privilege grants).
- `infra/shared/app-iam.test.ts`: per-app IAM derivation grants `cloudsql.client` only to `needsDb` apps, `pubsub.publisher/subscriber` only to workers, scoped `storage.objectAdmin` only to storage users, and `www` receives no DB/secret/Pub-Sub roles.
- `infra/shared/compliance-config.test.ts`: `complianceMode` resolution sets `logRetentionDays` defaults (2190 hipaa / 365 soc2 / none disables sink), toggles CMEK + org-policy + audit-log flags, and `none` produces no compliance resources.
- `infra/shared/preflight.test.ts`: preflight fails (with actionable error) on missing auth, unlinked billing, missing project, missing required config keys, or unreachable state bucket; passes only when all hold.
- `infra/shared/policies/gcp-sandbox.test.ts` (extend existing): denies `allUsers` on non-public services; denies public Cloud SQL IP when `complianceMode != none`; denies buckets without public-access prevention; denies primitive `owner`/`editor` on runtime SAs.
- `infra/shared/env-manifest.test.ts` (extend existing): production env wiring resolves per-app secret env references and the `app./api./mcp.` + apex URLs from `baseDomain`.

## Verification

- `pnpm type-check`
- `pnpm lint`
- `pnpm --filter @infra/shared test` (or the infra policy/vitest project)
- `pulumi preview` per layer against a sandbox stack with the CrossGuard policy pack (`policy-pack: ../../shared/policies`)
