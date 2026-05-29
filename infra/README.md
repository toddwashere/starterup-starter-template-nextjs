# Infrastructure & Deploy Profiles

Choose a hosting platform, run an init wizard, and deploy the full monorepo stack with minimal manual configuration.

## Choose a profile

| Profile | Sandbox | Production (floor) | Perpetual 100% free? | Complexity |
|---------|---------|-----------|-----|-----------|
| **local** | $0 | $0 | Yes | Low |
| **vercel + supabase** | $0* | ~$45–90/mo | Sandbox only | Medium |
| **render** | $0* | ~$35–75/mo | No | Medium |
| **gcp** | ~$0–30/mo | ~$80–150/mo | No | High |
| **aws** | ~$0–45/mo | ~$90–160/mo | No | High |
| **azure** | ~$15–40/mo | ~$85–155/mo | No | High |

\* Hobby limits, pauses, expiry — not production-ready.

## Prerequisites

Before deploying to any profile:

- **Accounts:** Cloud provider account (GCP/AWS/Azure) or PaaS account (Render, Vercel, Supabase, Upstash)
- **CLI tools:** `gcloud`, `aws`, `az` (for Pulumi clouds); `render`, `vercel` (for PaaS)
- **Billing alerts:** Set up budget alerts at $10, $25, and $50 USD on your cloud account *before* deploy
- **Optional:** Separate cloud project/account for sandbox (easy kill switch via project deletion)

## Startup credits

Platforms offer free credit programs for new startups. Apply *before* your first paid deploy to maximize runway.

### Cloud platforms

| Platform | Program | Bootstrapped | Funded | Apply |
|----------|---------|--------------|--------|-------|
| **GCP** | Google for Startups Cloud | ~$2,000 | Up to ~$200K (~$350K AI) | https://startup.google.com/cloud/ |
| **AWS** | AWS Activate | $1,000 (Founders) | Up to $100K (Portfolio) | https://aws.amazon.com/startups/credits/ |
| **Azure** | Microsoft for Startups Founders Hub | ~$1,000 | Up to ~$150K (tiered) | https://www.microsoft.com/en-us/startups |
| **Vercel** | Vercel for Startups | Up to $30K | AI Accelerator (cohort) | https://vercel.com/startups/credits |
| **Render** | Render Startup Program | $500 | $2.5K–$100K via partners | https://render.com/startups |

### Vercel profile — also apply for stack partners

| Service | Program | Apply |
|---------|---------|-------|
| **Supabase** (Postgres) | Supabase Startup | https://supabase.com/solutions/startups |
| **Upstash** (Redis) | Upstash startup / free tier | https://upstash.com |

**Disclaimer:** Approval not guaranteed; credits expire; payment method may still be required.

## Quick start

Placeholder commands (implemented in Phase 0.2):

```bash
# Initialize: answer wizard prompts for profile, region, domain
pnpm infra:init

# Deploy: build, migrate, and launch services
pnpm infra:deploy

# Preview (Pulumi clouds only)
pnpm infra:preview

# Teardown: delete all cloud resources
pnpm infra:destroy
```

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

- **Postgres 16** (no extensions) — `postgresql://postgres:postgres@localhost:5432/starter_dev`
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

## Architecture

Full specification with queue matrix, consumer modes, deploy ordering, and migration safety:

[`docs/superpowers/specs/2026-05-28-deploy-profiles-design.md`](../docs/superpowers/specs/2026-05-28-deploy-profiles-design.md)
