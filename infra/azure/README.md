# Azure (Pulumi)

Sandbox and production stacks for Microsoft Azure — Container Apps, PostgreSQL Flexible Server, Service Bus, and Key Vault.

Two Pulumi projects live here:

| Project | Path | What it owns |
|---------|------|--------------|
| `starter-azure-core` | `infra/azure/core/` | Resource Group, Flexible Postgres, Service Bus Namespace + queue, Key Vault + DATABASE_URL secret |
| `starter-azure-apps` | `infra/azure/apps/` | Container Apps environment + 5 Container App services (dashboard, www, public-api, public-mcp, workers) |

`apps` depends on `core` via `pulumi.StackReference`. Deploy `core` first.

## Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/install/) installed
- [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) installed and authenticated (`az login`)
- An Azure subscription with billing enabled
- An Azure Container Registry (ACR) for Docker images (`az acr create`)

See [infra/README.md](../README.md) for Azure startup credits and credit programs.

## First-time setup

These projects are **not** in the pnpm workspace. Install deps inside each project dir:

```sh
cd infra/azure/core
pnpm install          # or: npm install
pulumi stack init sandbox
pulumi config set azure-native:location eastus
pulumi config set starter-azure-core:resourceGroupName starter-sandbox-rg
pulumi config set starter-azure-core:dbSkuName Standard_B1ms
pulumi config set starter-azure-core:dbVersion 16

cd ../apps
pnpm install
pulumi stack init sandbox
pulumi config set azure-native:location eastus
pulumi config set starter-azure-apps:coreStackRef <org>/starter-azure-core/sandbox
pulumi config set starter-azure-apps:imageRegistry starter.azurecr.io
```

`Pulumi.sandbox.yaml` in each directory contains these keys as placeholders — edit them or set via `pulumi config set`.

## Deploy

```sh
# 1. Core infrastructure
cd infra/azure/core
pulumi up -s sandbox

# 2. App services (reads outputs from core)
cd ../apps
pulumi up -s sandbox
```

## Sandbox vs production

- **sandbox** (`Pulumi.sandbox.yaml`): minimal resources — Consumption-tier Container Apps, smallest Flexible Server SKU (`Standard_B1ms`), Basic Service Bus tier, no Application Gateway / Front Door. Not suitable for production.
- **production** (`Pulumi.production.yaml`): HA Postgres, VNet integration, premium Container Apps environment, Front Door. This is future work — see Task 7.1 notes.

See the [deploy-profiles spec](../../docs/superpowers/specs/2026-05-28-deploy-profiles-design.md) for the full profile breakdown.

## GitHub Actions deploy

> **TODO:** A `.github/workflows/deploy-azure.yml` workflow was not shipped in this task. It can be added following the same pattern as `deploy-gcp.yml` and `deploy-aws.yml`. Key differences: use `azure/login@v2` with OIDC federated credentials instead of `aws-actions/configure-aws-credentials` or `google-github-actions/auth`, and push images to ACR (`az acr login`) rather than ECR or Artifact Registry.

### Required secrets (once you add the workflow)

| Secret | Description |
|--------|-------------|
| `AZURE_CLIENT_ID` | Client ID of the app registration used for OIDC |
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |
| `PULUMI_ACCESS_TOKEN` | Pulumi Cloud personal/org access token |
| `DATABASE_URL_DEPLOY` | Postgres connection string used by `prisma migrate deploy` |

### Required variables

| Variable | Example |
|----------|---------|
| `AZURE_CONTAINER_REGISTRY` | `starter.azurecr.io` |
| `AZURE_LOCATION` | `eastus` |

### GitHub Environment: `production-azure`

Create the environment at **Settings → Environments → New environment** and add required reviewers.

### Workload Identity Federation (OIDC)

OIDC authentication removes the need for long-lived service principal credentials.
Setup guide: <https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect>

Grant the federated identity these roles on your subscription:
- `Contributor` (or a narrower custom role scoped to the resource group)
- `AcrPush` on the Container Registry
- `Key Vault Secrets Officer` on the Key Vault

### How the workflow jobs would be ordered

1. **preview** (PR only) — runs `pulumi preview` on sandbox and posts a comment.
2. **build-images** (push/dispatch) — builds and pushes all 5 app images to ACR via Docker matrix.
3. **deploy** (push/dispatch, after `build-images`, gated by `production-azure` approval):
   - `prisma migrate deploy` — runs before rolling new images.
   - `pulumi up` core stack — Flexible Postgres, Service Bus, Key Vault.
   - `pulumi up` apps stack — Container App revisions pinned to `github.sha`.

---

## Billing alerts (mandatory)

**Before your first deploy, configure budget alerts.** Runaway Container Apps or Postgres costs can accumulate quickly.

Set up an Azure Cost Management budget using the `az` CLI:

```sh
# Find your subscription ID
az account show --query id -o tsv

# Create a $50/month budget with alerts at 80% and 100%
az consumption budget create \
  --budget-name starter-azure-budget \
  --amount 50 \
  --time-grain Monthly \
  --start-date $(date +%Y-%m-01) \
  --end-date 2030-01-01 \
  --resource-group starter-sandbox-rg \
  --notifications \
    "{'actual_GreaterThan_80_Percent':{'enabled':true,'operator':'GreaterThan','threshold':80,'contactEmails':['your@email.com'],'thresholdType':'Actual'}}" \
    "{'actual_GreaterThan_100_Percent':{'enabled':true,'operator':'GreaterThan','threshold':100,'contactEmails':['your@email.com'],'thresholdType':'Actual'}}"
```

Also enable **Cost Anomaly Alerts** in the Azure Cost Management portal for automatic anomaly detection.

Docs: <https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets>

---

## Startup credits

See [infra/README.md](../README.md) — the Microsoft for Startups Founders Hub program provides up to $150,000 in Azure credits for eligible startups.

Microsoft for Startups: <https://foundershub.startups.microsoft.com/>
