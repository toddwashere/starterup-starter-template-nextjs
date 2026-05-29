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

- **sandbox** (`Pulumi.sandbox.yaml`): minimal resources, smallest Cloud SQL tier (`db-f1-micro`), no HA, public IP DB, `maxInstanceCount: 2`.
- **production** (`Pulumi.production.yaml`): HA Postgres, private Cloud SQL IP, VPC connector, min-instance warm dashboard, higher Cloud Run cap.

See the [deploy-profiles spec](../../docs/superpowers/specs/2026-05-28-deploy-profiles-design.md) for the full profile breakdown.

## Production deploy

### What changes in production

| Feature | Sandbox | Production |
|---------|---------|------------|
| Cloud SQL tier | `db-f1-micro` | `db-custom-2-7680` (2 vCPU / 7.5 GB) |
| Availability | `ZONAL` | `REGIONAL` (multi-zone HA) |
| Point-in-time recovery | disabled | enabled |
| Cloud SQL IP | public (SQL Proxy socket) | private (VPC connector) |
| VPC | none | `starter-vpc` + Serverless VPC connector |
| `minInstanceCount` | 0 (all services) | 1 for dashboard (warm), 0 for others |
| `maxInstanceCount` | 2 (CrossGuard enforced) | 10 |
| Global HTTPS LB | n/a | optional — set `enableHttpsLb: true` |
| Canary traffic split | n/a | optional — set `canaryRevision` + `canaryPercent` |

Use separate GCP projects for sandbox and production to isolate billing, IAM, and quotas.

### First-time production setup

```sh
cd infra/gcp/core
pnpm install
pulumi stack init production
# Edit Pulumi.production.yaml with your prod project ID, or use:
pulumi config set gcp:project  your-prod-project-id  --stack production
# ... set remaining keys as shown in Pulumi.production.yaml ...

cd ../apps
pnpm install
pulumi stack init production
pulumi config set starter-gcp-apps:coreStackRef  <org>/starter-gcp-core/production  --stack production
# ... set remaining keys ...
```

### Deploy order (production)

Follow the migration → producers → readiness → workers pattern documented in
`.github/workflows/deploy-gcp.yml`:

1. `prisma migrate deploy` — run before rolling new images
2. `pulumi up -s production` in `core/` — Cloud SQL, VPC, Pub/Sub, Secret Manager
3. `pulumi up -s production` in `apps/` — Cloud Run services
4. Smoke-test `/api/health` on dashboard and public-api

### Optional: global HTTPS load balancer

Set `enableHttpsLb: true` and `lbDomain: app.example.com` in
`infra/gcp/apps/Pulumi.production.yaml`. Pulumi will provision a serverless NEG,
backend service, URL map, Google-managed TLS certificate, HTTPS target proxy,
and a global forwarding rule. Point your DNS A record at the reserved IP before
provisioning the cert (Google-managed certs require DNS propagation).

### Optional: canary traffic split

Set `canaryRevision` (e.g. `starter-dashboard-00042-abc`) and `canaryPercent`
(e.g. `5`) in `infra/gcp/apps/Pulumi.production.yaml`. The scaffolding in
`apps/index.ts` shows the traffic block shape; wire it into the dashboard
Service definition and redeploy. Canary only fires on the production stack.

### Required Cloud Run service-account IAM roles

| Role | Required for |
|------|-------------|
| `roles/cloudsql.client` | Cloud SQL connections |
| `roles/secretmanager.secretAccessor` | DATABASE_URL secret |
| `roles/pubsub.publisher` | Pub/Sub topic publish |
| `roles/pubsub.subscriber` | Pub/Sub subscription pull |

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
