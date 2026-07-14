# Getting started — AWS (account-per-environment)

This guide is the human runbook for standing up the AWS profile. It captures the
steps that are **not** in code (accounts, identity, BAA) and the exact order to
run the Pulumi stacks. For the resource/config reference, see
[`README.md`](./README.md).

> [!IMPORTANT]
> **Your AWS credentials — not any config file — decide which account gets the
> resources.** Pulumi deploys to whatever account your active credentials point
> at. The `Pulumi.<env>.yaml` and `config.<env>.ts` files only pick _sizing and
> compliance_, never the account. So the golden rule is: **the AWS profile you
> authenticate with must match the environment stack you deploy.** See
> [The golden rule](#the-golden-rule-credentials--account) below.

---

## Recommended layout: one AWS account per environment

Isolating each environment in its own AWS account gives you a hard blast-radius
boundary and a clean escape hatch: **closing an account tears down every lingering
resource**, which is the simplest possible answer to orphaned-resource anxiety.

Create an **AWS Organization** from a clean management account, then add member
accounts:

```
mgmt (root, no workloads)
├── starter-state        → retained S3/KMS Pulumi state for every environment
├── starter-sandbox      → deploy stack: sandbox
├── starter-staging      → deploy stack: staging
├── starter-production   → deploy stack: production
└── (optional) starter-log-archive   → immutable HIPAA/SOC2 logs
```

Why an Organization (vs standalone accounts): consolidated billing, one-click
account closure, per-account budgets, and Service Control Policy (SCP)
guardrails (e.g. org-wide "deny public RDS", "deny disabling CloudTrail"). You
still get full isolation.

---

## The golden rule: credentials = account

Set up one named profile per account (via IAM Identity Center / SSO is cleanest),
then **always pair the profile with the matching stack**:

```bash
# ~/.aws/config — one profile per account
[profile starter-sandbox]     # account 1111-1111-1111
[profile starter-staging]     # account 2222-2222-2222
[profile starter-production]  # account 3333-3333-3333

# Deploy: profile MUST match the stack name
AWS_PROFILE=starter-sandbox    pulumi up -s sandbox
AWS_PROFILE=starter-staging    pulumi up -s staging
AWS_PROFILE=starter-production pulumi up -s production
```

Record each environment's 12-digit account id in the **gitignored**
`infra/.env.local` (copy from `infra/.env.example`) — never in committed config,
since this is a template repo:

```bash
# infra/.env.local  (gitignored)
AWS_SANDBOX_ACCOUNT_ID=1111...
AWS_STAGING_ACCOUNT_ID=2222...
AWS_PRODUCTION_ACCOUNT_ID=3333...

# DIY Pulumi backends always use this literal StackReference org segment.
PULUMI_ORG=organization

# Dedicated state account + required globally unique resource prefix.
AWS_STATE_ACCOUNT_ID=4444...
AWS_STATE_PROFILE=starter-state
AWS_STATE_RESOURCE_PREFIX=my-company-cross-account-state

# Vercel OIDC identifiers for the hybrid access role (core reads these).
VERCEL_TEAM_SLUG=my-team
VERCEL_PROJECT_NAME=my-project
```

`config.<env>.ts` and the stack programs read these via `infra/aws/env.ts`. Load
them before deploying (`set -a && source infra/.env.local && set +a`), or just
use the `pnpm infra:aws` wrapper, which auto-loads `infra/.env.local`. Note the
account id is only a **sanity-check** value — the real deploy account is whatever
your credentials point at. Always confirm before applying:

```bash
aws sts get-caller-identity   # verify Account matches the stack you're deploying
```

---

## The config model: three places, three jobs

Configuration is deliberately split so a template repo commits **no** account
ids or deployment-specific identifiers:

| Where                                 | Committed?          | Holds                                  | Read by                                                   |
| ------------------------------------- | ------------------- | -------------------------------------- | --------------------------------------------------------- |
| `infra/.env.local`                    | **No** (gitignored) | Account ids, `PULUMI_ORG`, `VERCEL_*`  | `infra/aws/env.ts` → `config.*.ts` and the stack programs |
| `infra/aws/config.<env>.ts`           | Yes                 | Sizing, compliance mode, feature flags | The stack programs at deploy time                         |
| `infra/aws/<layer>/Pulumi.<env>.yaml` | Yes                 | `aws:region`, `imageTag`               | Pulumi/AWS provider                                       |

Rules of thumb: **secrets and identifiers → `.env.local`**; **shape of the
environment (sizes, compliance) → `config.<env>.ts`**; **deploy-time knobs the
Pulumi/AWS provider needs → `Pulumi.<env>.yaml`**. Values that used to be pasted
into `Pulumi.<env>.yaml` (the account-bearing `imageRegistry`, the org-bearing
`coreStackRef`) are now derived at runtime from `getCallerIdentity` and
`PULUMI_ORG`, so nothing account-specific lives in committed YAML.

---

## What is manual vs. in code

| Concern                                                               | Where                                    | Why                                                                      |
| --------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| Org + member accounts                                                 | **Manual (console)**                     | Account lifecycle is a human decision; enables "close to clean up"       |
| Human/CLI access (IAM Identity Center / SSO)                          | **Manual (console)**                     | Generates the `AWS_PROFILE`s above                                       |
| BAA acceptance (AWS Artifact)                                         | **Manual (console)**                     | Legal step; required before any PHI in staging/production                |
| Anthropic first-time-use form                                         | **Manual (console)**                     | Submit once from the management account; organization members inherit it |
| Root user hardening (MFA, no keys)                                    | **Manual (console)**                     | One-time account security                                                |
| Central Pulumi state foundation                                       | **CloudFormation via `infra:aws:state`** | Must exist independently of the Pulumi stacks it stores                  |
| GitHub OIDC provider + deploy role                                    | **`bootstrap` stack**                    | Codified, repeatable per account                                         |
| ECR repository                                                        | **`bootstrap` stack**                    | Codified                                                                 |
| Cost budget + alerts                                                  | **`bootstrap` stack**                    | Codified                                                                 |
| VPC, RDS, Proxy, PgBouncer, SQS, S3, Secrets, EventBridge, compliance | **`core` stack**                         | Codified                                                                 |
| App Runner services, workers Lambda, VPC connector                    | **`apps` stack**                         | Codified                                                                 |
| Bedrock invocation logging                                            | **Manual (one CLI call)**                | Pulumi provider gap (see README)                                         |
| Third-party secret _values_                                           | **Manual (console/CLI)**                 | Never in git — see [Secrets](#secrets)                                   |

---

## One-time manual checklist (per account)

Before workload deployment, create a no-workload Organization member account
for state, assign the Identity Center administrator group, and configure a
`starter-state` SSO profile. Record only its account ID and profile name in
`infra/.env.local`; do not create IAM users or access keys. The state account is
created manually, while its retained S3/KMS/CloudTrail resources are created by
`pnpm infra:aws:state`.

1. **Create the account** as an Organization member (or standalone).
2. **Enable IAM Identity Center** and create a permission set; note the
   `AWS_PROFILE` name you'll use.
3. **Harden the root user**: enable MFA, delete any root access keys.
4. **Accept the organization BAA** in AWS Artifact before PHI enters any member
   account.
5. **Submit Anthropic's first-time-use form** once from the management account.
   Bedrock model access is otherwise enabled on first use; the configured model
   and region are in `ai.bedrockModels` / `ai.bedrockRegion`.
6. Everything else is codified — continue to [Deploy order](#deploy-order).

---

## Deploy order

Run the stacks in this order, each while authenticated to the target account.

The `pnpm infra:aws <layer> <pulumi args…>` wrapper runs `pulumi` inside the
layer directory with `infra/.env.local` loaded (so `PULUMI_ORG` / `VERCEL_*` /
account ids are present). Set `AWS_PROFILE` to match the target account. You can
also `cd` into a layer and run `pulumi` directly if you source `.env.local`
yourself.

### 0. Central state foundation (once per environment)

The state script verifies both SSO profiles, deploys retained S3/KMS/CloudTrail
resources to the dedicated state account, verifies cross-account
write/read/delete and KMS cryptographic access with temporary probes, and logs
Pulumi into that environment's backend. It does **not** initialize or deploy
any Pulumi layer.

Run only the environments you intend to configure:

```bash
pnpm infra:aws:state init sandbox
pnpm infra:aws:state init staging
pnpm infra:aws:state init production
```

The command prints the exact AWS KMS secrets-provider URL and follow-up commands.
Re-run the corresponding state command whenever you switch Pulumi between
environment backends.

### 1. Bootstrap (once per account, admin credentials)

Codifies the GitHub OIDC deploy role, the ECR repo, and the budget.

```bash
cd infra/aws/bootstrap && pnpm install && cd -
PULUMI_SECRETS_PROVIDER='<printed awskms:///... URL>'
AWS_PROFILE=starter-sandbox pnpm infra:aws bootstrap stack init sandbox \
  --secrets-provider="$PULUMI_SECRETS_PROVIDER"
AWS_PROFILE=starter-sandbox pnpm infra:aws bootstrap config set aws:region us-east-2
AWS_PROFILE=starter-sandbox pnpm infra:aws bootstrap config set starter-aws-bootstrap:githubRepo <owner>/<repo>
AWS_PROFILE=starter-sandbox pnpm infra:aws bootstrap config set starter-aws-bootstrap:budgetNotificationEmail you@example.com
AWS_PROFILE=starter-sandbox pnpm infra:aws bootstrap preview -s sandbox
AWS_PROFILE=starter-sandbox pnpm infra:aws bootstrap up -s sandbox
```

Note the outputs — `deployRoleArn`, `ecrRepositoryUrl` — you'll feed the role/URL
into GitHub Actions (`AWS_DEPLOY_ROLE_ARN`, `AWS_ECR_REGISTRY`). The apps stack
no longer needs the ECR URL as config: it derives the registry from the deploy
account + region at runtime.

### 2. Core

```bash
cd infra/aws/core && pnpm install && cd -
AWS_PROFILE=starter-sandbox pnpm infra:aws core stack init sandbox \
  --secrets-provider="$PULUMI_SECRETS_PROVIDER"
AWS_PROFILE=starter-sandbox pnpm infra:aws core config set aws:region us-east-2
AWS_PROFILE=starter-sandbox pnpm infra:aws core preview -s sandbox
AWS_PROFILE=starter-sandbox pnpm infra:aws core up -s sandbox
```

### 3. Apps

```bash
cd infra/aws/apps && pnpm install && cd -
AWS_PROFILE=starter-sandbox pnpm infra:aws apps stack init sandbox \
  --secrets-provider="$PULUMI_SECRETS_PROVIDER"
AWS_PROFILE=starter-sandbox pnpm infra:aws apps config set aws:region us-east-2
# coreStackRef comes from PULUMI_ORG; imageRegistry from the deploy account —
# no per-stack config to set here.
AWS_PROFILE=starter-sandbox pnpm infra:aws apps preview -s sandbox
AWS_PROFILE=starter-sandbox pnpm infra:aws apps up -s sandbox
```

Repeat 0–3 for `staging` and `production`, each with the matching profile and
that environment's printed KMS provider URL. If a stack already exists, use
`stack select` instead of `stack init`.

### 4. Bedrock invocation logging (manual, once per account/region)

The pinned `@pulumi/aws` can't manage this yet, so enable it by hand — see the
command in [`README.md`](./README.md) (§Bedrock invocation logging).

---

## Secrets

Two kinds of secrets, both kept out of git:

### Derived (automatic)

`core` generates the RDS password and writes the connection-string secrets —
`/starter/<env>/database-url`, `/starter/<env>/direct-url`, and (hybrid)
`/starter/<env>/vercel-database-url`. You never author or commit these; they're
materialized at deploy time from the generated password and resource endpoints.

### Manually-managed (placeholders)

For secrets Pulumi can't derive (third-party API keys, webhook signing secrets),
add an entry to `infra/aws/core/manual-secrets.ts`:

```ts
export const MANUAL_SECRETS: readonly ManualSecretSpec[] = [
  { name: "stripe-secret-key", description: "Stripe secret API key" },
];
```

On the next `pulumi up`, core creates an **empty** `/starter/<env>/stripe-secret-key`
secret seeded with a placeholder. Set the real value once — Pulumi never reads or
overwrites it afterward (`ignoreChanges` on the value):

```bash
aws secretsmanager put-secret-value \
  --secret-id /starter/sandbox/stripe-secret-key \
  --secret-string 'sk_live_…'
```

This is why **real secret values never live in git**. Grant read access to the
secret from whichever app role needs it.

---

## SQS queues

Queues live in a registry: `infra/aws/core/queues.ts`. Add one by appending to
`QUEUES` — each entry gets a **dead-letter queue and redrive policy
automatically**:

```ts
export const QUEUES: readonly QueueSpec[] = [
  { key: "jobs", visibilityTimeoutSeconds: 60, maxReceiveCount: 5 },
  { key: "emails" }, // gets starter-emails-<env> + starter-emails-dlq-<env>
];
```

Physical names are `starter-<key>-<env>` and `starter-<key>-dlq-<env>`. Every
queue's URL/ARN is exported via the `queueUrls` / `queueArns` maps for wiring.

> The `jobs` queue is load-bearing — the workers Lambda and EventBridge Scheduler
> in the `apps` stack consume it, so keep its `key` stable. A **new** queue needs
> its own consumer (event source mapping / handler) added in
> `infra/aws/apps/index.ts`.

---

## Tearing down a sandbox

Non-production stacks are disposable (no deletion protection, `forceDestroy` on
S3, 0-day secret recovery), so:

```bash
# apps, then core, then bootstrap
AWS_PROFILE=starter-sandbox pnpm infra:aws apps destroy -s sandbox
AWS_PROFILE=starter-sandbox pnpm infra:aws core destroy -s sandbox
AWS_PROFILE=starter-sandbox pnpm infra:aws bootstrap destroy -s sandbox
```

If anything is left behind, the account-per-environment layout is your safety
net: close the member account in the Organization to guarantee a clean slate.

---

## See also

- [`README.md`](./README.md) — architecture, full config reference, cost table,
  CI/CD, compliance mapping.
- [`../vercel/README.md`](../vercel/README.md) — hybrid Vercel + AWS wiring.
