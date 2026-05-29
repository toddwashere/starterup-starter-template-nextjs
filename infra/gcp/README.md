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

## GitHub Actions deploy

The workflow at `.github/workflows/deploy-gcp.yml` automates sandbox previews and production deploys.
**It is scaffolding** — it will not run end-to-end until you complete the one-time setup below.

### Required secrets (GitHub repo → Settings → Secrets and variables → Actions)

| Secret | Description |
|--------|-------------|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Full resource name of the WIF provider, e.g. `projects/123/locations/global/workloadIdentityPools/github/providers/github` |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | Service account email used for deployments, e.g. `github-deploy@your-project.iam.gserviceaccount.com` |
| `PULUMI_ACCESS_TOKEN` | Pulumi Cloud personal/org access token |
| `DATABASE_URL_DEPLOY` | Postgres connection string used by `prisma migrate deploy` (Cloud SQL Auth Proxy URL or direct IAM-authed connection) |

### Required variables (GitHub repo → Settings → Secrets and variables → Actions → Variables)

| Variable | Example |
|----------|---------|
| `GCP_REGION` | `us-central1` |
| `GCP_ARTIFACT_REGISTRY` | `us-central1-docker.pkg.dev/your-project/starter` |

### GitHub Environment: `production-gcp`

Create the environment at **Settings → Environments → New environment** and add required reviewers.
The `deploy` job will pause for approval before applying changes to production.

### Workload Identity Federation

OIDC authentication removes the need for long-lived service account keys.
Setup guide: <https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines>

Grant the WIF service account these roles on your GCP project:
- `roles/run.admin`
- `roles/cloudsql.client`
- `roles/artifactregistry.writer`
- `roles/secretmanager.admin` (or a narrower custom role)
- `roles/iam.serviceAccountUser`

### Manual sandbox deploy

```sh
gh workflow run deploy-gcp.yml -f stack=sandbox
```

### How the workflow jobs are ordered

1. **preview** (PR only) — runs `pulumi preview` on sandbox and posts a comment.
2. **build-images** (push/dispatch) — builds and pushes all 5 app images via Docker matrix.
3. **deploy** (push/dispatch, after `build-images`, gated by `production-gcp` approval):
   - `prisma migrate deploy` — runs before rolling new images.
   - `pulumi up` core stack — Cloud SQL, Pub/Sub, Secret Manager.
   - `pulumi up` apps stack — Cloud Run services pinned to `github.sha`.
   - Smoke-tests `/health` on dashboard and public-api.

---

## Billing alerts (mandatory)

**Before your first deploy, configure budget alerts.** Runaway Cloud Run or Cloud SQL costs can accumulate quickly.

Set alerts at $10, $25, and $50 USD using the `gcloud` CLI (replace `BILLING_ACCOUNT_ID`):

```sh
# Find your billing account ID
gcloud billing accounts list

# Create budget with alert thresholds at 20 %, 50 %, and 100 % of $50
gcloud billing budgets create \
  --billing-account=BILLING_ACCOUNT_ID \
  --display-name="starter-gcp-budget" \
  --budget-amount=50USD \
  --threshold-rule=percent=0.2 \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=1.0
```

Repeat with `--budget-amount=10USD` and `--budget-amount=25USD` for earlier warnings, or use the
[GCP Billing console](https://console.cloud.google.com/billing) for a UI-guided setup.

Docs: <https://cloud.google.com/billing/docs/how-to/budgets>

---

## Startup credits

See [infra/README.md](../README.md) — the Google for Startups and GCP free tier sections apply here.
