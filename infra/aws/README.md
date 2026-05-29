# AWS (Pulumi)

Sandbox and production stacks for Amazon Web Services — ECS Fargate, RDS Postgres, SQS + DLQ, and Secrets Manager.

Two Pulumi projects live here:

| Project | Path | What it owns |
|---------|------|--------------|
| `starter-aws-core` | `infra/aws/core/` | RDS Postgres, SQS + DLQ, Secrets Manager entries |
| `starter-aws-apps` | `infra/aws/apps/` | ECS Fargate services (dashboard, www, public-api, public-mcp, workers) |

`apps` depends on `core` via `pulumi.StackReference`. Deploy `core` first.

## Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/install/) installed
- [AWS CLI](https://aws.amazon.com/cli/) installed and configured (`aws configure` or environment credentials)
- An AWS account with billing enabled
- An ECR repository (or registry) for Docker images

See [infra/README.md](../README.md) for AWS startup credits and credit programs.

## First-time setup

These projects are **not** in the pnpm workspace. Install deps inside each project dir:

```sh
cd infra/aws/core
pnpm install          # or: npm install
pulumi stack init sandbox
pulumi config set aws:region us-east-1
pulumi config set starter-aws-core:dbInstanceClass db.t4g.micro
pulumi config set starter-aws-core:dbEngineVersion 16
pulumi config set starter-aws-core:dbAllocatedStorage 20

cd ../apps
pnpm install
pulumi stack init sandbox
pulumi config set aws:region us-east-1
pulumi config set starter-aws-apps:coreStackRef <org>/starter-aws-core/sandbox
pulumi config set starter-aws-apps:imageRegistry <account-id>.dkr.ecr.us-east-1.amazonaws.com/starter
```

`Pulumi.sandbox.yaml` in each directory contains these keys as placeholders — edit them or set via `pulumi config set`.

## Deploy

```sh
# 1. Core infrastructure
cd infra/aws/core
pulumi up -s sandbox

# 2. App services (reads outputs from core)
cd ../apps
pulumi up -s sandbox
```

## Sandbox vs production

- **sandbox** (`Pulumi.sandbox.yaml`): minimal resources — default VPC (no NAT Gateway), smallest RDS instance (`db.t4g.micro`), Fargate with `desiredCount: 1`, no ALB. Tasks use `assignPublicIp: true` for outbound connectivity. Not suitable for production.
- **production** (`Pulumi.production.yaml`): HA RDS, private subnets, NAT Gateway, ALB, autoscaling. This is future work — see Task 7.1 notes.

See the [deploy-profiles spec](../../docs/superpowers/specs/2026-05-28-deploy-profiles-design.md) for the full profile breakdown.

## GitHub Actions deploy

The workflow at `.github/workflows/deploy-aws.yml` automates sandbox previews and production deploys.
**It is scaffolding** — it will not run end-to-end until you complete the one-time setup below.

### Required secrets (GitHub repo → Settings → Secrets and variables → Actions)

| Secret | Description |
|--------|-------------|
| `AWS_DEPLOY_ROLE_ARN` | ARN of the IAM role GitHub Actions assumes via OIDC, e.g. `arn:aws:iam::123456789012:role/github-deploy` |
| `PULUMI_ACCESS_TOKEN` | Pulumi Cloud personal/org access token |
| `DATABASE_URL_DEPLOY` | Postgres connection string used by `prisma migrate deploy` |

### Required variables (GitHub repo → Settings → Secrets and variables → Actions → Variables)

| Variable | Example |
|----------|---------|
| `AWS_REGION` | `us-east-1` |
| `AWS_ECR_REGISTRY` | `123456789012.dkr.ecr.us-east-1.amazonaws.com/starter` |

### GitHub Environment: `production-aws`

Create the environment at **Settings → Environments → New environment** and add required reviewers.
The `deploy` job will pause for approval before applying changes to production.

### GitHub OIDC with AWS IAM

OIDC authentication removes the need for long-lived AWS access keys.
Setup guide: <https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html>

Create an IAM OIDC identity provider for `token.actions.githubusercontent.com` and attach a role with these policies on your AWS account:
- `AmazonECS_FullAccess`
- `AmazonRDSFullAccess`
- `AmazonSQSFullAccess`
- `SecretsManagerReadWrite`
- `AmazonEC2ContainerRegistryPowerUser`
- `IAMFullAccess` (or a narrower custom role)

### Manual sandbox deploy

```sh
gh workflow run deploy-aws.yml -f stack=sandbox
```

### How the workflow jobs are ordered

1. **preview** (PR only) — runs `pulumi preview` on sandbox and posts a comment.
2. **build-images** (push/dispatch) — builds and pushes all 5 app images to ECR via Docker matrix.
3. **deploy** (push/dispatch, after `build-images`, gated by `production-aws` approval):
   - `prisma migrate deploy` — runs before rolling new images.
   - `pulumi up` core stack — RDS, SQS, Secrets Manager.
   - `pulumi up` apps stack — ECS Fargate services pinned to `github.sha`.

---

## Billing alerts (mandatory)

**Before your first deploy, configure budget alerts.** Runaway ECS, RDS, or NAT costs can accumulate quickly.

Set up AWS Budgets using the AWS Console or CLI:

```sh
# Example: $50/month budget with alerts at 20%, 50%, 100%
aws budgets create-budget \
  --account-id <AWS_ACCOUNT_ID> \
  --budget '{
    "BudgetName": "starter-aws-budget",
    "BudgetLimit": { "Amount": "50", "Unit": "USD" },
    "TimeUnit": "MONTHLY",
    "BudgetType": "COST"
  }' \
  --notifications-with-subscribers '[
    {
      "Notification": {
        "NotificationType": "ACTUAL",
        "ComparisonOperator": "GREATER_THAN",
        "Threshold": 80
      },
      "Subscribers": [{ "SubscriptionType": "EMAIL", "Address": "your@email.com" }]
    }
  ]'
```

Also enable **Cost Anomaly Detection** in the AWS Cost Management console for automatic anomaly alerts.

Docs: <https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html>

---

## Startup credits

See [infra/README.md](../README.md) — the AWS Activate program provides up to $100,000 in AWS credits for eligible startups.

AWS Activate: <https://aws.amazon.com/activate/>
