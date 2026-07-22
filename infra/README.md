# Infrastructure & Deploy Profiles

Choose a hosting platform, run an init wizard, and deploy the full monorepo stack with minimal manual configuration.

## Choose a profile

| Profile               | Sandbox    | Production (floor) | Perpetual 100% free? | Complexity |
| --------------------- | ---------- | ------------------ | -------------------- | ---------- |
| **local**             | $0         | $0                 | Yes                  | Low        |
| **vercel + supabase** | $0\*       | ~$45–90/mo         | Sandbox only         | Medium     |
| **render**            | $0\*       | ~$35–75/mo         | No                   | Medium     |
| **gcp**               | ~$28–35/mo† | ~$330–390/mo†     | No                   | High       |
| **aws**               | ~$0–45/mo  | ~$90–160/mo        | No                   | High       |
| **azure**             | ~$15–40/mo | ~$85–155/mo        | No                   | High       |

\* Hobby limits, pauses, expiry — not production-ready.
† GCP per-env: sandbox ~$28–35/mo, staging ~$77/mo (`db-custom-1-3840`), production ~$330–390/mo (`db-custom-2-7680` REGIONAL HA). Sandbox and staging use the same always-private topology as production (VPC + Serverless VPC connector + Private Services Access + private Cloud SQL; no Cloud NAT).

## Prerequisites

Before deploying to any profile:

- **Accounts:** Cloud provider account (GCP/AWS/Azure) or PaaS account (Render, Vercel, Supabase, Upstash)
- **CLI tools:** `gcloud`, `aws`, `az` (for Pulumi clouds); `render`, `vercel` (for PaaS)
- **Billing alerts:** Set up budget alerts at $10, $25, and $50 USD on your cloud account _before_ deploy
- **Optional:** Separate cloud project/account for sandbox (easy kill switch via project deletion)
- **Infra operator env:** `cp infra/.env.example infra/.env.local` — GCP needs `PULUMI_CONFIG_PASSPHRASE`; AWS/Azure use `PULUMI_ACCESS_TOKEN` (see file). Not the same as root `.env` for app dev.

## Startup credits

Platforms offer free credit programs for new startups. Apply _before_ your first paid deploy to maximize runway.

### Cloud platforms

| Platform   | Program                             | Bootstrapped      | Funded                   | Apply                                    |
| ---------- | ----------------------------------- | ----------------- | ------------------------ | ---------------------------------------- |
| **GCP**    | Google for Startups Cloud           | ~$2,000           | Up to ~$200K (~$350K AI) | https://startup.google.com/cloud/        |
| **AWS**    | AWS Activate                        | $1,000 (Founders) | Up to $100K (Portfolio)  | https://aws.amazon.com/startups/credits/ |
| **Azure**  | Microsoft for Startups Founders Hub | ~$1,000           | Up to ~$150K (tiered)    | https://www.microsoft.com/en-us/startups |
| **Vercel** | Vercel for Startups                 | Up to $30K        | AI Accelerator (cohort)  | https://vercel.com/startups/credits      |
| **Render** | Render Startup Program              | $500              | $2.5K–$100K via partners | https://render.com/startups              |

### Vercel profile — also apply for stack partners

| Service                 | Program                     | Apply                                   |
| ----------------------- | --------------------------- | --------------------------------------- |
| **Supabase** (Postgres) | Supabase Startup            | https://supabase.com/solutions/startups |
| **Upstash** (Redis)     | Upstash startup / free tier | https://upstash.com                     |

**Disclaimer:** Approval not guaranteed; credits expire; payment method may still be required.

## Quick start (GCP master orchestrator)

All commands accept `--env sandbox|staging|production` (default `sandbox`) and run a
preflight (auth, billing, project, state bucket, required config) before any apply.
State lives in a self-managed GCS bucket (`<project>-pulumi-state`); the orchestrator
creates it idempotently and runs `pulumi login gs://…` for you.

```bash
# Edit infra/gcp/config.sandbox.ts, then validate + fan out layer stack config
pnpm infra:configure --env sandbox

# One-time per env: ensure state bucket + pulumi login + stack init (runs configure first)
pnpm infra:init --env sandbox

# Deploy all six layers in dependency order (bootstrap → db/storage/messaging → secrets → apps)
pnpm infra:deploy --env sandbox

# Deploy a single layer
pnpm infra:deploy database --env staging

# Read-only diff (L3) for every layer
pnpm infra:preview --env sandbox

# Tear down in reverse order (apps → … → bootstrap), with confirmation.
# database/storage are protected — unprotect them first (the command prints how).
pnpm infra:destroy --env sandbox

# L4 ephemeral proof: apply → smoke-test → destroy a throwaway stack (on-demand only)
pnpm infra:test:ephemeral
```

> The multi-cloud profile wizard moved to `pnpm infra:init:profile`.

### Pipelines

- **Infra pipeline** — `.github/workflows/infra-deploy.yml`, manual `workflow_dispatch`
  with `{env, layer}` inputs. Uses Workload Identity Federation; `production` routes
  through the `production-gcp` GitHub Environment (required reviewers). Runs `pnpm infra:deploy`.
- **App release pipeline** — `.github/workflows/app-release.yml`, on push to `main`/tags.
  Builds+pushes all 5 images → runs the `platform-migrate` Cloud Run Job as a gate →
  deploys each Cloud Run revision `--no-traffic` → smoke-tests the candidate → shifts
  traffic to 100%. Rollback: `gcloud run services update-traffic <svc> --to-revisions <prev>=100`.

### Zero-downtime rules (enforced / process)

1. New revision deployed `--no-traffic`, gated on a health smoke before any traffic.
2. **Expand/contract migrations** — old and new revisions share the DB during rollout, so
   every migration must be backward-compatible (add nullable/new → backfill → later drop).
3. **Graceful shutdown / worker drain** on SIGTERM; workers finish/ack in-flight jobs before exit.
4. **Backward-compatible Pub/Sub message contracts** (at-least-once; concurrent old/new workers).
5. Prior revisions are retained for instant rollback.

## Profile guides

- [GCP (Pulumi)](gcp/README.md)
- [AWS (Pulumi)](aws/README.md)
- [Azure (Pulumi)](azure/README.md)
- [Render](render/README.md)
- [Vercel + Supabase](vercel/README.md)

## Local development

Start all infrastructure locally with `docker compose`:

```bash
docker compose up -d postgres redis
```

Includes:

- **Postgres 16** (no extensions) — `postgresql://postgres:postgres@localhost:5432/app_db`
- **Redis 7** for BullMQ — `redis://localhost:6379`
- **Workers** — `pnpm --filter @apps/workers dev` polls for jobs

Migrate and seed the database (no Postgres extensions required — fresh DBs need `prisma migrate deploy` only):

```bash
pnpm --filter @workspace/database exec prisma migrate deploy
pnpm --filter @workspace/database db:seed
```

## Sandbox vs. production

Each profile supports two variants:

### Sandbox

- Cost caps via CrossGuard policies (no NAT, no LB, `maxInstanceCount ≤ 2`)
- Separate cloud project/account (optional, recommended)
- Not production-ready; zero-downtime deployments not required
- Suitable for development and staging

### Production

- Full redundancy, load balancing, readiness probes, graceful worker drain
- DB `protect: true` + cloud deletion protection
- Billing alerts at $10/$25/$50 (mandatory in init wizard)
- Rolling deploys, backward-compatible migrations only

## Teardown

Remove all infrastructure and billing:

**Local:** Stop `docker compose`:

```bash
docker compose down -v
```

**Pulumi clouds (GCP, AWS, Azure):**

```bash
pnpm infra:destroy
```

Runs `pulumi destroy` for the selected stack; optionally delete the entire cloud project.

**Render:** Suspend or delete the blueprint and services from the Render dashboard.

**Vercel + Supabase:** Delete Vercel projects and the Supabase organization from their respective dashboards.

## Troubleshooting

Common env wiring mistakes — coming soon. See [Architecture](#architecture) for design context.

## Policy enforcement in CI

Pulumi [CrossGuard](https://www.pulumi.com/docs/iac/crossguard/) policies in `infra/shared/policies/` run automatically on every PR that touches `infra/**`:

- **`infra-policy.yml`** — type-checks and unit-tests the policy pack (Vitest). Runs on any PR that touches `infra/gcp/**`, `infra/aws/**`, `infra/azure/**`, or `infra/shared/policies/**`.
- **`deploy-gcp.yml` / `deploy-aws.yml`** (preview job) — passes `policy-pack: ../../shared/policies` to `pulumi preview` so CrossGuard enforces sandbox guardrails (no GlobalForwardingRule, `maxInstanceCount <= 2`) during PR builds. Violations fail the preview step and block merge.
- **Azure** — no CrossGuard policy ships for Azure yet; add rules to the shared policy pack when needed.

### Cost estimation

Infracost is **not wired** to this repository. Infracost requires Terraform plan output; Pulumi does not produce Terraform-format plans natively. A custom shim converting `pulumi preview --json` to Terraform plan format would be required and is out of scope.

Recommended alternatives:

- **Pulumi Cloud Cost Explorer** (paid feature): https://www.pulumi.com/docs/iac/concepts/options/pulumi-cost-explorer
- **Manual estimates**: use the cost ranges in the profile table above; set up GCP/AWS/Azure budget alerts at $10, $25, and $50 USD via the init wizard.

## Architecture

Full specification with queue matrix, consumer modes, deploy ordering, and migration safety:

[`docs/superpowers/specs/2026-05-28-deploy-profiles-design.md`](../docs/superpowers/specs/2026-05-28-deploy-profiles-design.md)
