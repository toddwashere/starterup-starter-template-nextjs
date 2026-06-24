# GCP (Pulumi)

Turnkey Google Cloud infrastructure for the whole stack: Cloud Run (all 5 apps), Cloud SQL
(Postgres), GCS, Pub/Sub + optional Redis, Secret Manager, and an optional global HTTPS load
balancer — provisioned by a **single orchestrator command**.

You create the GCP project and link billing manually. Everything else is automated, in the
right order, with a preflight that fails fast on misconfiguration (no apply-fail-fix loop).

---

## TL;DR — deploy a sandbox in 4 steps

```bash
# 0. One-time machine setup
gcloud auth application-default login          # authenticate
gcloud projects create my-sandbox-proj         # or use an existing project
# → link a billing account to the project in the GCP console (Billing → Link)

# 1. Set your project in infra/gcp/config.sandbox.yaml
#    (copy from config.sandbox.example.yaml if needed)

# 2. Validate config and fan out to all six Pulumi layer stack files
pnpm infra:configure --env sandbox

# 3. One-time per env: create state bucket + init all stacks
pnpm infra:init --env sandbox

# 4. Deploy all six layers in dependency order
pnpm infra:deploy --env sandbox
```

Env profiles live at `infra/gcp/config.<env>.yaml` — secret-free and safe to commit.
Re-run `pnpm infra:configure --env <env>` after pulling infra changes to merge new defaults.

That's it. The orchestrator creates a self-managed Pulumi state bucket
(`<project>-pulumi-state`), logs in to it, runs a preflight, then applies every layer.

> Real third-party secrets (Stripe, Resend, etc.) are created **empty** — apps that need them
> won't start until you populate them. See [Populate secrets](#5-populate-third-party-secrets).

---

## The six layers

Each layer is an independent Pulumi project under `infra/gcp/<layer>/`, with one stack per
environment (`sandbox`, `staging`, `production`). Dependencies flow strictly downward via
`pulumi.StackReference`, so a change to one layer can't ripple into another.

| #   | Layer       | Owns                                                                                                                                                      | Protected            |
| --- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | `bootstrap` | API enablement, VPC + connector, Artifact Registry, deploy SA + Workload Identity Federation, billing budget, (compliance: KMS, audit logs, org policies) | KMS keys, log bucket |
| 2   | `database`  | Cloud SQL Postgres instance + db + user + generated password                                                                                              | ✅ instance          |
| 3   | `storage`   | GCS `uploads` bucket (uniform access, public-access prevention, versioning)                                                                               | ✅ bucket            |
| 4   | `messaging` | Pub/Sub topic + DLQ + subscription; flag-gated Memorystore Redis                                                                                          | —                    |
| 5   | `secrets`   | Secret Manager entries (generated + placeholder) + composed `DATABASE_URL`                                                                                | —                    |
| 6   | `apps`      | 5 Cloud Run services + per-app least-privilege SAs, `migrate` job, flag-gated HTTPS LB + Cloud Armor + monitoring                                         | —                    |

Deploy order: `bootstrap → database → storage → messaging → secrets → apps`.
Destroy order is the reverse (`database`/`storage` are protected — the command tells you how to unprotect).

---

## Commands

All commands take `--env sandbox|staging|production` (default `sandbox`) and run a preflight
(auth, billing, project, state bucket, required config) before any apply.

```bash
pnpm infra:init     --env <env>            # one-time: state bucket + login + stacks + config
pnpm infra:deploy   --env <env>            # deploy ALL layers in order
pnpm infra:deploy   database --env <env>   # deploy ONE layer
pnpm infra:preview  --env <env>            # read-only diff of every layer (free, no apply)
pnpm infra:destroy  --env <env>            # tear down in reverse order (with confirmation)
pnpm infra:test:ephemeral                  # apply → smoke-test → destroy a throwaway sandbox stack
```

> The old multi-cloud profile wizard now lives at `pnpm infra:init:profile`.

---

## Full setup

### 1. Prerequisites (once per machine)

- [`gcloud` CLI](https://cloud.google.com/sdk/docs/install) and
  [Pulumi CLI](https://www.pulumi.com/docs/install/) installed
- `gcloud auth application-default login`
- A GCP project with **billing linked** (the preflight will refuse to deploy otherwise)

### 2. Point an environment at your project

Each environment maps to a **separate GCP project** (isolates billing, IAM, quotas). Edit the
env profile for the environment you're deploying:

`infra/gcp/config.<env>.yaml` (copy from `config.<env>.example.yaml` if needed)

```yaml
gcp:
  project: "my-sandbox-proj" # ← your project ID
  region: "us-central1"
complianceMode: "none"
# … see config.sandbox.example.yaml for all options
```

`pnpm infra:configure --env sandbox` validates your config and writes all six
`Pulumi.<env>.yaml` layer files. `pnpm infra:init` runs configure automatically.

### 3. Initialize the environment

```bash
pnpm infra:init --env sandbox
```

Creates the GCS state bucket, runs `pulumi login gs://…`, and initializes + configures all six
stacks. Idempotent — safe to re-run.

### 4. Deploy

```bash
pnpm infra:deploy --env sandbox
```

Applies the six layers in order behind the preflight gate. To iterate on one layer:
`pnpm infra:deploy apps --env sandbox`.

### 5. Populate third-party secrets

The `secrets` layer auto-generates `database-url`, `better-auth-secret`, and
`campaign-unsubscribe-secret`. The following are created **empty** — add a value before the
apps that read them will start:

```bash
printf '%s' 'sk_live_…'   | gcloud secrets versions add stripe-secret-key      --data-file=- --project my-sandbox-proj
printf '%s' 'whsec_…'     | gcloud secrets versions add stripe-webhook-secret  --data-file=- --project my-sandbox-proj
printf '%s' 're_…'        | gcloud secrets versions add resend-api-key         --data-file=- --project my-sandbox-proj
printf '%s' 'sk-or-…'     | gcloud secrets versions add openrouter-api-key     --data-file=- --project my-sandbox-proj
printf '%s' 'https://…'   | gcloud secrets versions add sentry-dsn             --data-file=- --project my-sandbox-proj
```

Real keys never enter Pulumi state or stack config.

### 6. Verify

```bash
pnpm infra:preview --env sandbox     # should show "no changes"
# Cloud Run URLs:
cd infra/gcp/apps && pulumi stack output --stack sandbox
```

---

## Environments

| Env          | Typical use     | Cloud SQL                                        | Networking | Compliance | HTTPS LB                 |
| ------------ | --------------- | ------------------------------------------------ | ---------- | ---------- | ------------------------ |
| `sandbox`    | dev / throwaway | `db-f1-micro`, public IP                         | none       | `none`     | off (raw Cloud Run URLs) |
| `staging`    | pre-prod        | `db-custom-2-7680`, private IP                   | VPC        | `none`     | off                      |
| `production` | live            | `db-custom-2-7680` REGIONAL HA, private IP, PITR | VPC        | `soc2`     | on                       |

Defaults live in each layer's `Pulumi.<env>.yaml` — override per env as needed.

---

## Feature flags

Set in the relevant layer's `Pulumi.<env>.yaml`. Off = the resource is not created.

| Flag               | Layer       | Default                       | Effect                                        |
| ------------------ | ----------- | ----------------------------- | --------------------------------------------- |
| `enableRedis`      | messaging   | `false`                       | Memorystore Redis cache                       |
| `enableHttpsLb`    | apps        | `false` (prod `true`)         | Global HTTPS LB + Cloud Armor + managed certs |
| `enableMonitoring` | apps        | `false` (staging/prod `true`) | Uptime checks + alert policies                |
| `complianceMode`   | every layer | `none` (prod `soc2`)          | HIPAA/SOC 2 control bundle (see below)        |

---

## Production: domains, TLS, and the load balancer

DNS stays at **your registrar** (e.g. Namecheap); GCP owns the LB, WAF, and TLS.

1. In `infra/gcp/apps/Pulumi.production.yaml` set `enableHttpsLb: "true"` and
   `lbDomain: "example.com"`, then `pnpm infra:deploy apps --env production`.
2. Read the outputs and add records at your registrar:

   ```bash
   cd infra/gcp/apps
   pulumi stack output lbIpAddress             --stack production   # → A records
   pulumi stack output dnsAuthorizationRecords --stack production   # → cert-auth CNAMEs
   ```

   - A records: `app.`, `api.`, `mcp.`, apex + `www.` → the LB IP
   - The DNS-authorization CNAMEs so Google-managed certs provision (zero-downtime cutover)

Host routing: `app.` → dashboard, `api.` → public-api, `mcp.` → public-mcp, apex + `www.` → www.
Workers stay internal (no public ingress).

---

## Compliance mode (HIPAA / SOC 2)

Set `complianceMode` to `soc2`, `hipaa`, or `hipaa+soc2` in **each layer's** `Pulumi.<env>.yaml`
for that environment (keep them consistent across the env). When enabled it adds: Data Access
audit logs, an immutable bucket-locked log sink, CMEK on Cloud SQL / GCS / Pub/Sub, org-policy
constraints, Essential Contacts, Binary Authorization, and Cloud Armor. With `none` (the
default), none of these resources are created.

```yaml
# e.g. infra/gcp/bootstrap/Pulumi.production.yaml
config:
  starter-gcp-bootstrap:complianceMode: "soc2"
  starter-gcp-bootstrap:securityContactEmail: "security@example.com" # Essential Contacts
```

**Out of scope (manual):** signing the Google BAA, the audit + evidence collection, periodic
access reviews, and keeping PHI out of app logs.

---

## CI/CD pipelines

Two GitHub Actions workflows, both authenticating via Workload Identity Federation (no JSON keys):

- **`infra-deploy.yml`** — manual (`workflow_dispatch`) with `{env, layer}` inputs. Runs
  `pnpm infra:deploy`. `production` routes through the `production-gcp` GitHub Environment
  (required reviewers).
- **`app-release.yml`** — on push to `main` / tags. Builds + pushes all 5 images → runs the
  `starter-migrate` Cloud Run Job as a gate → deploys each Cloud Run revision `--no-traffic` →
  smoke-tests the candidate → shifts traffic to 100%. Rollback is a traffic shift to the prior
  revision.
- **`deploy-gcp.yml`** — PR-only `pulumi preview` (L3) of all layers with the CrossGuard policy pack.

### One-time CI setup

1. Set `starter-gcp-bootstrap:githubRepo: "your-org/your-repo"` in the bootstrap stack config
   for each env and redeploy `bootstrap` (this binds the WIF pool to your repo's deploy SA).
2. Add GitHub **secrets** (Settings → Secrets and variables → Actions):

   | Secret                           | Value                                                                    |
   | -------------------------------- | ------------------------------------------------------------------------ |
   | `GCP_WORKLOAD_IDENTITY_PROVIDER` | `cd infra/gcp/bootstrap && pulumi stack output workloadIdentityProvider` |
   | `GCP_DEPLOY_SERVICE_ACCOUNT`     | `… pulumi stack output deployServiceAccountEmail`                        |
   | `PULUMI_CONFIG_PASSPHRASE`       | passphrase encrypting stack secrets on the GCS backend                   |

3. Add GitHub **variables**: `GCP_REGION` (e.g. `us-central1`), `GCP_ARTIFACT_REGISTRY`
   (`… pulumi stack output artifactRegistryRepo`).
4. Create the **`production-gcp`** environment (Settings → Environments) and add required reviewers.

---

## Teardown

```bash
pnpm infra:destroy --env sandbox
```

Destroys in reverse order. `database` and `storage` are protected — the command prints the
`pulumi state unprotect` step to run first. For a hard reset, delete the GCP project.

---

## Billing alerts

The `bootstrap` layer creates a budget when you set `billingAccountId` + `budgetAmount` (alerts
at 20 % / 50 % / 100 %). To add manual alerts instead:

```bash
gcloud billing accounts list
gcloud billing budgets create \
  --billing-account=BILLING_ACCOUNT_ID \
  --display-name="starter-gcp-budget" \
  --budget-amount=50USD \
  --threshold-rule=percent=0.2 --threshold-rule=percent=0.5 --threshold-rule=percent=1.0
```

Docs: <https://cloud.google.com/billing/docs/how-to/budgets>

## Startup credits

See [infra/README.md](../README.md) — the Google for Startups Cloud Program and GCP free-tier
sections apply here.

## Design reference

[`docs/superpowers/specs/2026-06-06-gcp-comprehensive-iac-design.md`](../../docs/superpowers/specs/2026-06-06-gcp-comprehensive-iac-design.md)
