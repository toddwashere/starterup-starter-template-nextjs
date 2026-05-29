# Deploy Profiles & Infrastructure Design

**Date:** 2026-05-28  
**Status:** Approved

## Overview

Add multi-profile deployment support to the SaaS starter template so a developer can choose a hosting platform, run an init wizard, and deploy the full monorepo stack (five runnable services, Postgres, queue, schedulers, secrets, CI/CD) with minimal manual wiring and a low risk of misconfiguration.

Infrastructure lives at the repo root in **`infra/`** (platform configuration — not imported by application packages). Application code keeps a single `enqueue()` API; queue transport and consumer runtime vary by profile.

This spec **replaces pgmq + pg_cron** with profile-appropriate queues and schedulers. Plain Postgres works on every managed database (Supabase, Render Postgres, Cloud SQL, RDS, Azure Flexible Server) without extensions.

**Supersedes / updates:** [`2026-05-22-worker-queue-pgmq-design.md`](./2026-05-22-worker-queue-pgmq-design.md) and [`2026-05-22-worker-queue-pgmq-deploy.md`](./2026-05-22-worker-queue-pgmq-deploy.md) for production deploy paths. Local development migrates from extension-based Postgres to **BullMQ + Redis** (optional `sync` adapter for unit tests).

---

## Goals

- **Fast path to production:** init wizard → deploy in a small number of commands.
- **Profile choice:** GCP, AWS, Azure (Pulumi), Render, Vercel + Supabase (platform config).
- **Low error rate:** typed env manifest auto-wires cross-service URLs; deploy ordering enforced in CI.
- **Cost awareness:** sandbox vs production variants, billing alerts, CrossGuard caps, documented monthly floors.
- **Safety:** DB `protect` + cloud deletion protection; Prisma-only schema changes; separate core stacks.
- **Zero downtime (production):** rolling deploys, readiness probes, graceful worker drain, expand/contract migrations.
- **Developer onboarding:** `infra/README.md` with profile comparison, init/deploy steps, and **startup credit program links**.

## Non-goals (v1)

- Firebase App Hosting as a primary profile.
- Abstract multi-cloud factory hiding all providers behind one interface.
- Admin UI for failed jobs / DLQ browser.
- Full GCP LocalStack equivalent (use docker compose locally + `pulumi preview` + optional emulators).
- Committing encrypted production secrets to git beyond Pulumi stack config patterns documented per profile.
- Retrofitting every existing doc that mentions pgmq (incremental cleanup during implementation).

---

## Decisions

| Topic | Decision |
|-------|----------|
| **IaC tool (clouds)** | Pulumi (TypeScript) for GCP, AWS, Azure |
| **PaaS config** | `render.yaml` + per-profile README (Render); Vercel project templates (Vercel) |
| **Repo layout** | Root **`infra/`** folder — not `packages/infra` |
| **Multi-cloud pattern** | Separate pre-baked profiles per provider — not one abstract factory |
| **Queue (local, Render, Vercel)** | **BullMQ + Redis** |
| **Queue (GCP / AWS / Azure)** | **Pub/Sub / SQS / Service Bus** (cloud-native) |
| **pgmq + pg_cron** | **Removed** — no Postgres extensions for queue/cron |
| **Local Postgres** | Stock Postgres 16 in docker compose (drop custom pgmq/pg_cron image) |
| **Consumer runtime** | **poll** (long-lived worker) everywhere except Vercel → **drain** (HTTP batch) |
| **Render ≈ Vercel** | Same BullMQ adapter and handlers; differ on consumer (worker vs drain) and Redis host |
| **Vercel Postgres** | Supabase — standard Postgres, no extensions |
| **Vercel scheduling** | QStash and/or Vercel Cron (Pro) — not Supabase pg_cron |
| **Prisma migrations** | Core schema only — remove/skip `worker_extensions` migration |
| **v1 profile priority** | GCP (reference Pulumi) → Render → Vercel + Supabase → AWS → Azure |
| **Sandbox vs production** | Explicit variants per profile with different cost caps and networking |

---

## Deployable surface

| Service | Type | Port (local) | Container in cloud/PaaS |
|---------|------|--------------|-------------------------|
| `dashboard` | Next.js | 4000 | Yes (or Vercel native) |
| `www` | Next.js | 4001 | Yes (or Vercel native) |
| `public-api` | Hono HTTP | 4002 | Yes (or Vercel serverless) |
| `public-mcp` | MCP HTTP | 4003 | Yes (or Vercel serverless) |
| `workers` | Job consumer | 4300 (health) | Yes — **poll** mode; **not** on Vercel |
| Postgres | Prisma | 5432 | Managed per profile |
| Redis | BullMQ (local/PaaS) | 6379 | Render Redis / Upstash / ElastiCache / Memorystore / Azure Cache |

---

## Architecture

### Two deployment tiers

```text
┌─────────────────────────────────────────────────────────────────┐
│  Tier 1 — Full cloud (Pulumi)                                    │
│  GCP · AWS · Azure                                               │
│  VPC, managed Postgres, native queue, containers, secrets, CI    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Tier 2 — Managed PaaS (platform config)                         │
│  Render · Vercel + Supabase                                      │
│  render.yaml / Vercel projects — git-push DX                     │
└─────────────────────────────────────────────────────────────────┘
```

### Queue and scheduler matrix

```text
Producers (dashboard, public-api, auth, …)
        │
        ▼
   enqueue(event, payload)     ← @workspace/worker-queue (unchanged API)
        │
        ├── local · render · vercel  →  BullMQ  →  Redis
        ├── gcp                      →  Pub/Sub (+ DLQ topic)
        ├── aws                      →  SQS (+ DLQ)
        └── azure                    →  Service Bus (+ DLQ)
        │
        ▼
   Handler registry (apps/workers) — idempotent, at-least-once
```

| Profile | Queue adapter | Scheduler | Consumer mode |
|---------|---------------|-----------|---------------|
| **local** | `bullmq` | BullMQ repeatable jobs or HTTP cron → local route | **poll** (`apps/workers`) |
| **render** | `bullmq` | Render Cron → enqueue or HTTP | **poll** |
| **vercel** | `bullmq` | QStash / Vercel Cron → `/api/jobs/drain` or `/api/cron/*` | **drain** |
| **gcp** | `pubsub` | Cloud Scheduler → Pub/Sub or HTTP | **poll** |
| **aws** | `sqs` | EventBridge Scheduler → SQS or HTTP | **poll** |
| **azure** | `servicebus` | Logic Apps / timer → Service Bus or HTTP | **poll** |
| **tests** | `sync` | n/a | inline |

**Delivery semantics:** at-least-once everywhere. Handlers must remain idempotent (existing requirement).

### Consumer modes

| Mode | Where | Behavior |
|------|-------|----------|
| **poll** | local, Render, GCP, AWS, Azure | Long-lived `apps/workers` — BullMQ `Worker` or cloud SDK poll loop |
| **drain** | Vercel only | HTTP route processes N jobs per invocation, then exits |

Same handler functions; different invocation wrapper selected by `WORKER_CONSUMER_MODE=poll|drain` (or inferred from profile).

### Deploy ordering (all profiles)

```text
1. Build artifacts / container images (turbo prune per app)
2. prisma migrate deploy          ← backward-compatible migrations only
3. Deploy producers               ← dashboard, www, public-api, public-mcp
4. Wait for readiness probes
5. Deploy workers (or enable cron drain on Vercel)
```

---

## Folder structure

```text
infra/
├── README.md                 # Entry: profile picker, init, deploy, credits, teardown
├── STARTUP-CREDITS.md        # Optional detail table (linked from README)
├── shared/
│   ├── env-manifest.ts       # Maps keys.ts / .env.example → per-service requirements
│   ├── apps.manifest.ts      # Apps, ports, health paths, dockerfile names
│   ├── queue-profiles.ts     # profile → adapter + consumer mode
│   ├── policies/             # Pulumi CrossGuard (sandbox caps, DB protect)
│   └── docker/               # Shared turbo-prune Dockerfiles per app
├── gcp/
│   ├── core/                 # Pulumi: VPC, Cloud SQL, Pub/Sub, secrets
│   ├── apps/                 # Pulumi: Cloud Run × 5
│   ├── Pulumi.yaml
│   └── README.md
├── aws/
│   ├── core/
│   ├── apps/
│   └── README.md
├── azure/
│   ├── core/
│   ├── apps/
│   └── README.md
├── render/
│   ├── render.yaml
│   └── README.md
└── vercel/
    ├── projects.manifest.json
    ├── env.template.json
    └── README.md

scripts/
└── infra-init.ts             # Wizard: profile, variant, region, domains → writes config
```

Root `package.json` scripts (implementation detail):

- `pnpm infra:init` — run wizard
- `pnpm infra:deploy` — dispatches to profile-specific deploy
- `pnpm infra:preview` — Pulumi preview where applicable
- `pnpm infra:destroy` — documented teardown

---

## Profile details

### Local (`docker compose`)

| Component | Choice |
|-----------|--------|
| Postgres | Official `postgres:16` — **no extensions** |
| Redis | `redis:7` for BullMQ |
| Workers | `apps/workers` poll mode |
| Cron | BullMQ repeatable job for `cleanup.expired-sessions` or local HTTP cron |

Remove custom `docker/postgres` image (pgmq/pg_cron build). Update `docker-compose.yml`: add `redis`, simplify `postgres` service.

### GCP (Pulumi) — v1 reference implementation

**Sandbox variant**

- Cloud Run × apps on `*.run.app` URLs — no global HTTPS LB
- No Serverless VPC connector / NAT
- Cloud SQL smallest tier **or** documented external free Postgres for extreme sandbox
- `maxInstanceCount ≤ 2` per service
- Pub/Sub + Cloud Scheduler

**Production variant**

- Cloud SQL with `deletionProtection` + Pulumi `protect: true`
- Cloud Run with readiness probes, `terminationGracePeriodSeconds ≥ 30` on workers
- Optional global HTTPS LB + managed certs for custom domains
- Serverless VPC connector for private DB access
- Optional canary traffic split on dashboard

### AWS (Pulumi)

Same shape as GCP. **Sandbox defaults:**

- Prefer **no NAT Gateway, no ALB** — avoid Fargate 24/7 × 5 as default sandbox; document Lambda-oriented sandbox as optional future shortcut
- SQS + EventBridge; ECS Fargate with `desiredCount: 1`, `maxCapacity: 2`

**Production:** RDS, ECS services, ALB, optional NAT — document ~$90–160/mo floor.

### Azure (Pulumi)

Container Apps consumption, PostgreSQL Flexible Server, Service Bus. Sandbox/production split mirrors GCP.

### Render

| Component | Choice |
|-----------|--------|
| Postgres | Render Postgres |
| Redis | Render Key Value |
| Queue | BullMQ |
| Services | Web × 4 + background worker (poll) |
| Cron | Render Cron Jobs |
| Config | `infra/render/render.yaml` |

Free Render Postgres expires after 30 days — document as **preview only**. Paid starter ~$35–75/mo.

### Vercel + Supabase

| Component | Choice |
|-----------|--------|
| Next.js | `dashboard`, `www` — native Vercel projects |
| API | `public-api` — Hono Vercel adapter |
| MCP | `public-mcp` — fetch-based serverless entry |
| Postgres | Supabase — **no extensions** |
| Redis | Upstash — BullMQ |
| Workers | **No** `apps/workers` deploy — drain routes on `dashboard` (or dedicated micro-project) |
| Cron | QStash → HTTP; Vercel Cron on Pro for additional jobs |

Four+ Vercel projects; init wizard generates all env vars from manifest.

**Application changes required:**

- `public-api`: export Vercel `fetch` handler
- `public-mcp`: refactor from `node:http` to fetch handler
- `dashboard`: `/api/jobs/drain`, `/api/cron/*` routes
- `next.config`: `output: 'standalone'` for container profiles (parity)

---

## Environment & secrets

### Env manifest (`infra/shared/env-manifest.ts`)

Single source mapping each `keys.ts` / `.env.example` variable to:

- Which services need it
- Secret vs public
- Profile-specific defaults (localhost vs deployed URLs)
- Whether Pulumi, Render, or Vercel injects it

Wizard output: per-service env files or platform-specific config blocks — **no manual copy-paste of 40 variables**.

### Secrets strategy

| Profile | Non-sensitive config | Secrets |
|---------|---------------------|---------|
| Pulumi clouds | `pulumi config` (stack YAML) | Pulumi `config set --secret` + cloud Secret Manager references at runtime |
| Render | Env groups in blueprint | Render secret env vars |
| Vercel | Project env | Vercel encrypted env |

Never log `process.env` in production. Cloud Run / containers receive secrets via platform secret refs, not plaintext in Pulumi source.

---

## Database migrations

### Remove extension migration

Delete or replace `packages/database/prisma/migrations/20260522120000_worker_extensions/`:

- No `CREATE EXTENSION pgmq` / `pg_cron`
- No `pgmq.create('jobs')`
- No SQL `cron.schedule` for cleanup job

### Scheduled `cleanup.expired-sessions`

Implement via profile scheduler calling handler directly or `enqueue('cleanup.expired-sessions', {})`:

| Profile | Trigger |
|---------|---------|
| local | BullMQ repeatable / cron HTTP |
| render | Render Cron |
| vercel | QStash / Vercel Cron → `/api/cron/cleanup-expired-sessions` |
| gcp | Cloud Scheduler |
| aws | EventBridge |
| azure | Logic Apps / timer |

### Migration safety (production)

- **Expand/contract** only — no drop/rename in single deploy step while old code runs
- `migrate deploy` before new revision receives traffic
- CI optional: flag destructive SQL in new migrations

---

## CI/CD

### Existing `ci.yml`

- Replace custom Postgres image build with stock `postgres:16`
- Add Redis service for BullMQ integration tests (or keep unit tests on `sync` adapter only)
- Remove pgmq-specific assumptions

### New workflows (path-filtered)

| Workflow | Trigger paths | Actions |
|----------|---------------|---------|
| `deploy-gcp.yml` | `infra/gcp/**`, app Dockerfiles | OIDC → build images → `pulumi preview` (PR) / `pulumi up` (main) |
| `deploy-aws.yml` | `infra/aws/**` | Same pattern |
| `deploy-azure.yml` | `infra/azure/**` | Same pattern |
| Render / Vercel | Optional or platform git hooks | Document in profile README |

**Production deploy:** GitHub Environment manual approval.  
**PRs:** `pulumi preview` + CrossGuard + optional Infracost comment.

---

## Cost estimates (May 2026 — verify before deploy)

None of the full Pulumi stacks run on perpetual free tiers. Document **sandbox** vs **production** honestly.

| Profile | Sandbox | Production (floor) | Perpetual 100% free? |
|---------|---------|-------------------|----------------------|
| **local** | $0 | $0 | Yes |
| **vercel + supabase** | $0* | ~$45–90/mo | Sandbox only (Hobby + free tiers) |
| **render** | $0* (DB 30d) | ~$35–75/mo | No |
| **gcp** | ~$0–30/mo | ~$80–150/mo | No |
| **aws** | ~$0–45/mo | ~$90–160/mo | No |
| **azure** | ~$15–40/mo | ~$85–155/mo | No |

\* Hobby limits, pauses, expiry — not production.

---

## Cost safety

Mandatory in init wizard and `infra/README.md`:

1. **Billing budget alerts** at $10 / $25 / $50 (platform-specific links/CLI)
2. **Sandbox CrossGuard policies:** no NAT/LB; `maxInstanceCount` / `maxReplicas ≤ 2`; no oversized task CPU/RAM
3. **Separate sandbox cloud project/account** — delete project = kill switch
4. **DB:** `protect: true` + cloud `deletionProtection` in production stacks
5. **Teardown docs:** `pulumi destroy` / delete project / Render suspend
6. **Optional:** Infracost on infra PRs

Sandbox **does not** promise zero downtime — scale-to-zero cold starts acceptable.

---

## Zero-downtime deployments (production profiles)

| Layer | Requirement |
|-------|-------------|
| **Platform** | Rolling revision deploy (Cloud Run, ECS, Container Apps, Render paid, Vercel atomic) |
| **App** | `/health` (liveness) + `/ready` (DB connectivity, draining state) |
| **Workers** | SIGTERM → mark draining → finish in-flight job → exit within grace period |
| **Migrations** | Backward compatible; expand/contract for breaking changes |
| **Order** | migrate → producers → readiness OK → workers |

Optional: GCP/Azure canary traffic split (5% → 100%).

---

## Startup credits (`infra/README.md` section)

Encourage applications **before** first paid deploy. All five profiles have programs; amounts and eligibility differ.

| Profile | Program | Bootstrapped (typical) | Funded / partner | Apply |
|---------|---------|------------------------|------------------|-------|
| GCP | Google for Startups Cloud | ~$2,000 | Up to ~$200K (~$350K AI) | https://startup.google.com/cloud/ |
| AWS | AWS Activate | $1,000 (Founders) | Up to $100K (Portfolio) | https://aws.amazon.com/startups/credits/ |
| Azure | Microsoft for Startups Founders Hub | ~$1,000 | Up to ~$150K (tiered) | https://www.microsoft.com/en-us/startups |
| Vercel | Vercel for Startups | Up to $30K | AI Accelerator (cohort) | https://vercel.com/startups/credits |
| Render | Render Startup Program | $500 | $2.5K–$100K via partners | https://render.com/startups |

**Vercel profile — also apply for stack partners:**

| Service | Program | Apply |
|---------|---------|-------|
| Supabase (Postgres) | Supabase Startup | https://supabase.com/solutions/startups |
| Upstash (Redis) | Upstash startup / free tier | https://upstash.com |

Disclaimer: approval not guaranteed; credits expire; payment method may still be required.

---

## `infra/README.md` outline

The README is the developer entry point. Per-profile READMEs hold detail.

1. **Choose a profile** — comparison table (cost, free tier, complexity)
2. **Prerequisites** — accounts, CLIs, billing alerts
3. **Startup credits** — table above + “apply before deploy”
4. **Quick start** — `pnpm infra:init` → `pnpm infra:deploy`
5. **Profile guides** — links to `infra/{gcp,aws,azure,render,vercel}/README.md`
6. **Local development** — `docker compose up` (Postgres + Redis + workers)
7. **Sandbox vs production** — variants and cost caps
8. **Teardown**
9. **Troubleshooting** — common env wiring mistakes
10. **Architecture** — link to this spec

---

## Package & application changes (summary)

| Area | Change |
|------|--------|
| `packages/worker-queue` | Remove pgmq adapter; add `bullmq`, `pubsub`, `sqs`, `servicebus` adapters; extend `WORKER_QUEUE_ADAPTER` enum |
| `apps/workers` | BullMQ Worker (poll); graceful shutdown + `/ready`; cloud poll loops per adapter |
| `apps/dashboard` | Drain routes (Vercel); `/health` + `/ready`; optional cron routes |
| `apps/public-api` | Vercel `fetch` export |
| `apps/public-mcp` | Fetch-based serverless entry |
| `apps/*/next.config` | `output: 'standalone'` for container profiles |
| `docker-compose.yml` | Stock Postgres + Redis; remove extension postgres |
| `docker/postgres/` | Remove or archive |
| `.env.example` | `REDIS_URL`, updated `WORKER_QUEUE_ADAPTER` values; remove pgmq vars |
| `.github/workflows/ci.yml` | Stock Postgres; optional Redis |
| Docs | Archive/update pgmq deploy guide |

---

## Local / CI testing without cloud

| Concern | Approach |
|---------|----------|
| App dev | `docker compose` — Postgres + Redis + workers |
| Queue unit tests | `WORKER_QUEUE_ADAPTER=sync` (existing) |
| BullMQ integration | Redis in CI or testcontainers (optional v1) |
| Pulumi | `pulumi preview` + policy tests; optional dev GCP project |
| Pub/Sub emulator | Optional for GCP adapter tests only |
| Cloud Run | Test Docker images locally — no emulator |

---

## Implementation phases (for follow-up plan)

| Phase | Scope |
|-------|--------|
| **0** | Spec approval; `infra/README.md` skeleton + startup credits |
| **1** | Queue migration: BullMQ adapter, remove pgmq, docker compose + CI, migration cleanup |
| **2** | `infra/shared` manifests, turbo-prune Dockerfiles, health/readiness, worker graceful drain |
| **3** | `infra/gcp` Pulumi sandbox + production; deploy workflow; init wizard v1 |
| **4** | `infra/render` blueprint |
| **5** | `infra/vercel` templates + drain routes + Supabase/Upstash docs |
| **6** | `infra/aws`, `infra/azure` (same manifest shape as GCP) |
| **7** | Cloud queue adapters (pubsub, sqs, servicebus) + worker poll modes |

---

## Critical Tests

- `packages/worker-queue/src/adapters/bullmq.test.ts`: enqueue serializes envelope; worker processes job; failed job retries; respects max attempts; poison envelope archives without throw.
- `packages/worker-queue/src/resolve-adapter.test.ts`: selects bullmq/pubsub/sqs/servicebus/sync by env; unknown adapter throws.
- `packages/worker-queue/src/enqueue.test.ts`: event name + payload validated by Zod before publish; invalid payload rejected at producer.
- `apps/workers/src/consumer.test.ts`: drain/poll processes batch; SIGTERM draining rejects `/ready`; in-flight message completes before exit (poll mode).
- `apps/workers/src/graceful-shutdown.test.ts`: abort stops new polls; does not interrupt active handler beyond timeout.
- `infra/shared/env-manifest.test.ts`: each app receives required env keys for a given profile; cross-URL wiring produces valid `BETTER_AUTH_URL` / `NEXT_PUBLIC_*` combinations.
- `infra/shared/queue-profiles.test.ts`: each profile maps to exactly one adapter + consumer mode; vercel → drain, render → poll.
- `infra/shared/policies/crossguard.test.ts` (or policy unit tests): sandbox policy denies NAT/LB resources; production policy requires DB protect flag.

---

## Verification

- `pnpm validate:env`
- `pnpm lint`
- `pnpm type-check`
- `pnpm test`
- `pnpm --filter @workspace/worker-queue test`
- `pnpm --filter @apps/workers test`
- `docker compose up -d` → `prisma migrate deploy` → enqueue smoke job → worker processes (manual / future e2e)
- `pulumi preview` on `infra/gcp` (when implemented) with CrossGuard policies enabled

---

## References

- [Google for Startups Cloud](https://startup.google.com/cloud/)
- [AWS Activate](https://aws.amazon.com/startups/credits/)
- [Microsoft for Startups](https://www.microsoft.com/en-us/startups)
- [Vercel for Startups](https://vercel.com/startups/credits)
- [Render Startup Program](https://render.com/startups)
- [Supabase for Startups](https://supabase.com/solutions/startups)
- [Cloud Run pricing](https://cloud.google.com/run/pricing)
- Prior art (superseded for deploy): [`2026-05-22-worker-queue-pgmq-design.md`](./2026-05-22-worker-queue-pgmq-design.md)
