# GCP (Pulumi)

Sandbox and production stacks for Google Cloud — Cloud Run, Cloud SQL (Postgres), Pub/Sub, and Secret Manager.

Two Pulumi projects live here:

| Project | Path | What it owns |
|---------|------|--------------|
| `starter-gcp-core` | `infra/gcp/core/` | Cloud SQL, Pub/Sub topic + DLQ, Secret Manager entries |
| `starter-gcp-apps` | `infra/gcp/apps/` | Cloud Run services (dashboard, www, public-api, workers) |

`apps` depends on `core` via `pulumi.StackReference`. Deploy `core` first.

## Status

- **Task 3.1 (this commit):** scaffold — exports + StackReference wired; no real GCP resources yet.
- **Task 3.2 (next):** Cloud SQL, Pub/Sub, Secret Manager, Cloud Run services for sandbox.
- **Task 7.1 (future):** production hardening (HA Postgres, VPC, IAM).

## Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/install/) installed
- `gcloud auth application-default login` (or a service account key in `GOOGLE_CREDENTIALS`)
- A GCP project with billing enabled
- Artifact Registry repository for Docker images

See [infra/README.md](../README.md) for GCP startup credits and credit programs.

## First-time setup

These projects are **not** in the pnpm workspace. Install deps inside each project dir:

```sh
cd infra/gcp/core
pnpm install          # or: npm install
pulumi stack init sandbox
pulumi config set gcp:project  your-sandbox-project-id
pulumi config set gcp:region   us-central1
pulumi config set starter-gcp-core:dbTier    db-f1-micro
pulumi config set starter-gcp-core:dbVersion POSTGRES_16

cd ../apps
pnpm install
pulumi stack init sandbox
pulumi config set gcp:project  your-sandbox-project-id
pulumi config set gcp:region   us-central1
pulumi config set starter-gcp-apps:coreStackRef   <org>/starter-gcp-core/sandbox
pulumi config set starter-gcp-apps:imageRegistry  us-central1-docker.pkg.dev/<project>/starter
```

`Pulumi.sandbox.yaml` in each directory contains these keys as placeholders — edit them or set via `pulumi config set`.

## Deploy

```sh
# 1. Core infrastructure
cd infra/gcp/core
pulumi up -s sandbox

# 2. App services (reads outputs from core)
cd ../apps
pulumi up -s sandbox
```

## Sandbox vs production

- **sandbox** (`Pulumi.sandbox.yaml`): minimal resources, smallest Cloud SQL tier (`db-f1-micro`), no HA. Ships in Task 3.2.
- **production** (`Pulumi.production.yaml`): HA Postgres, VPC, stricter IAM, min-instances on Cloud Run. Ships in Task 7.1.

See the [deploy-profiles spec](../../docs/superpowers/specs/2026-05-28-deploy-profiles-design.md) for the full profile breakdown.

## Billing alerts

Set up budget alerts at $10 / $25 / $50 to avoid surprise bills while developing.
[GCP budget alert docs](https://cloud.google.com/billing/docs/how-to/budgets)

## Startup credits

See [infra/README.md](../README.md) — the Google for Startups and GCP free tier sections apply here.
