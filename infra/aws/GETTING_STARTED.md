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

## Part 1 — Quick runbook

Use this section when you want the shortest safe path. Stop immediately if an
account ID, profile, or Pulumi backend does not match the environment you intend
to change.

### A. Complete the one-time AWS setup

- [ ] Create the management, state, sandbox, staging, and production accounts
      in AWS Organizations.
- [ ] Enable IAM Identity Center and record its home region.
- [ ] Create your Identity Center user, administrator group, and permission set.
- [ ] Assign that group and permission set to all four member accounts.
- [ ] Accept the organization BAA and submit Anthropic's first-time-use form.
- [ ] Harden every root user with MFA and no access keys.

### B. Configure local SSO profiles

Create these profiles with `aws configure sso`:

| Account       | Local profile        |
| ------------- | -------------------- |
| Central state | `platform-state`      |
| Sandbox       | `platform-sandbox`    |
| Staging       | `platform-staging`    |
| Production    | `platform-production` |

Authenticate and verify the two accounts involved in a sandbox state deployment:

```bash
aws sso login --profile platform-state
aws sso login --profile platform-sandbox
aws sts get-caller-identity --profile platform-state
aws sts get-caller-identity --profile platform-sandbox
```

The first identity query must report the state account ID; the second must
report the sandbox account ID.

### C. Configure `infra/.env.local`

Copy `infra/.env.example` to the gitignored `infra/.env.local`, then define:

```dotenv
PULUMI_ORG=organization

# Deployment identity — set once before first deploy (defaults to "platform").
AWS_RESOURCE_PREFIX=<1-29-lowercase-letters-numbers-hyphens>

AWS_STATE_ACCOUNT_ID=<state-account-id>
AWS_STATE_PROFILE=platform-state
AWS_STATE_REGION=us-east-2
AWS_SSO_REGION=<identity-center-home-region>

AWS_SANDBOX_ACCOUNT_ID=<sandbox-account-id>
AWS_STAGING_ACCOUNT_ID=<staging-account-id>
AWS_PRODUCTION_ACCOUNT_ID=<production-account-id>

AWS_DNS_ROOT_DOMAIN=<your-root-domain>
AWS_POOLER_APP_EGRESS_CIDRS=<comma-delimited-app-egress-cidrs>
AWS_POOLER_DEVELOPER_CIDRS=<comma-delimited-developer-cidrs>
```

`AWS_RESOURCE_PREFIX` is the first AWS identity choice for a downstream repo.
It names state buckets, the ECR namespace, queues (`{prefix}-{queue}-{env}[-dlq]`),
resource tags, and the cross-account GitHub deploy role. Leaving it unset keeps
the template default `platform`. Changing it after an environment is deployed is
unsupported without a new environment or an explicit migration plan.

Legacy `AWS_STATE_RESOURCE_PREFIX` still works as a temporary alias (with a
deprecation warning). If both are set, they must match.

Workload profiles default to `platform-<environment>`. Override them with
`AWS_SANDBOX_PROFILE`, `AWS_STAGING_PROFILE`, or `AWS_PRODUCTION_PROFILE` only
when your local profile names differ.

> [!IMPORTANT]
> **DNS and pooler allowlist configuration:** `AWS_DNS_ROOT_DOMAIN` is your
> organization's real root domain (e.g., `example.com` not
> `sandbox.aws.example.com`). `AWS_POOLER_APP_EGRESS_CIDRS` must contain only
> stable outbound addresses from application hosting providers (Vercel Static
> IPs, Render stable IPs, etc.) in `/32` notation, comma-delimited.
> `AWS_POOLER_DEVELOPER_CIDRS` must contain developer workstation IPs in `/32`
> notation, comma-delimited. The value `0.0.0.0/0` is rejected. These values are
> **secret** and must remain in the gitignored `infra/.env.local` — never commit
> real domains, CIDRs, or IP addresses to version control.

### D. Create and verify the sandbox state foundation

```bash
pnpm infra:aws:state init sandbox
```

Success means all of the following appear:

- CloudFormation reports `Successfully created/updated stack`.
- The script reports `State foundation is ready`.
- The reported state account and workload account IDs are correct.
- `AWS_PROFILE=platform-sandbox pulumi whoami -v` reports the new S3 backend.

To spot-check in the browser:

1. Open the **AWS access portal**.
2. Expand the **state account**, then choose the administrator permission set
   and **Management console**.
3. Confirm the state account name/ID in the top-right corner.
4. Select **United States (Ohio) / `us-east-2`**.
5. Open S3 and confirm the state and audit buckets are present.
6. Open CloudFormation and confirm `<prefix>-sandbox` is `CREATE_COMPLETE`.

The sandbox workload account is still expected to be mostly empty at this
point. State resources intentionally live in the dedicated state account.

### E. Deploy the sandbox layers in order

Use the exact KMS secrets-provider URL printed by the state command:

1. Initialize, preview, and deploy `bootstrap`.
2. **CHECKPOINT:** Delegate the Route 53 hosted zone (see below).
3. Initialize, preview, and deploy `core`.
4. Build/push `linux/amd64` images to the per-app ECR repos, then deploy `apps`
   (see steps 7–8 below).

Before deploying `bootstrap`, set its required repository scope:

```bash
AWS_PROFILE=platform-sandbox pnpm infra:aws bootstrap config set \
  starter-aws-bootstrap:githubRepo <owner>/<repo>
```

Never run `up` until its preceding `preview` targets the expected account,
stack, and region. The complete commands and explanations are in
[Deploy order](#deploy-order).

#### Route 53 delegation checkpoint (between bootstrap and core)

After deploying `bootstrap`, the stack exports `hostedZoneNameServers` — four
AWS Route 53 name servers for the delegated zone. **You must create one NS
record set at your external DNS provider before deploying `core`**; otherwise
ACM certificate validation will fail.

1. **Read the name servers:**

   ```bash
   AWS_PROFILE=platform-sandbox pulumi stack output hostedZoneNameServers -s sandbox
   ```

   This prints an array of four name servers, e.g.:

   ```json
   [
     "ns-1234.awsdns-56.org",
     "ns-789.awsdns-12.com",
     "ns-345.awsdns-67.net",
     "ns-901.awsdns-23.co.uk"
   ]
   ```

2. **At your external DNS provider** (the registrar or DNS hosting service for
   your real `AWS_DNS_ROOT_DOMAIN`), create **one NS record set** for the
   subdomain `sandbox.aws.example.com` (substituting your real root domain)
   containing all four name server values. Most providers require a trailing dot
   for FQDN entries; consult your provider's documentation.

   Example (pseudo-syntax):

   ```
   Type: NS
   Name: sandbox.aws.example.com
   Values:
     ns-1234.awsdns-56.org.
     ns-789.awsdns-12.com.
     ns-345.awsdns-67.net.
     ns-901.awsdns-23.co.uk.
   TTL: 300
   ```

3. **Wait for propagation** (typically 1–5 minutes) and verify public delegation:

   ```bash
   dig NS sandbox.aws.example.com
   ```

   The answer section must list all four AWS name servers. Repeat for `staging`
   and `production` as you configure each environment.

4. **Public app host zones (every environment):** Bootstrap exports
   `publicAppHostZoneNameServers` — one Route 53 zone per public hostname
   (`dashboard-sandbox.example.com`, `api-sandbox.example.com`, … in non-prod;
   `dashboard.example.com`, `api.example.com`, … in production). At the registrar,
   add an **NS** record set for each hostname (copy the name servers from the
   bootstrap stack). The apps stack writes Alias A + ACM validation records
   inside those zones. Keep bare apex / mail at the registrar; do not paste
   App Runner CNAMEs there.

   ```bash
   AWS_PROFILE=platform-sandbox pulumi stack output publicAppHostZoneNameServers -s sandbox
   dig NS dashboard-sandbox.example.com
   ```

5. **Confirm the SNS subscription** (production only for email): The bootstrap
   stack creates critical + warning SNS topics for operational alerts. Optional
   Slack delivery uses AWS Chatbot (`slackTeamId` / `slackChannelId` stack
   config). Production may also email the
   `starter-aws-bootstrap:budgetNotificationEmail` address for critical alerts —
   confirm that subscription once if configured.

6. **Deploy core:**

   ```bash
   AWS_PROFILE=platform-sandbox pnpm infra:aws core preview -s sandbox
   AWS_PROFILE=platform-sandbox pnpm infra:aws core up -s sandbox
   ```

   The `core` stack creates an ACM certificate for `db.sandbox.aws.example.com`
   (substituting your real domain), validates it via DNS, provisions the TLS
   exporter Lambda (which writes exported certificate material to a
   KMS-encrypted Secrets Manager secret consumed by PgBouncer), and creates the
   Route 53 alias record pointing to the PgBouncer NLB.

7. **Verify TLS connectivity:**

   ```bash
   dig A db.sandbox.aws.example.com
   aws acm list-certificates --profile platform-sandbox --region us-east-2
   openssl s_client -starttls postgres \
     -connect db.sandbox.aws.example.com:6432 \
     -servername db.sandbox.aws.example.com
   ```

   The `openssl` command should complete the TLS handshake and print the
   certificate chain. If it reports `Verify return code: 0 (ok)`, TLS is
   correctly configured.

7. **Build and push app images (required before `apps up`):** Bootstrap creates
   one ECR repository per image under `<identity>/<name>`
   (`dashboard`, `www`, `public-api`, `public-mcp`, `workers`, `workers-lambda`).
   App Runner and Lambda pull `…/<identity>/<name>:<tag>` (default identity
   `platform`). Images must be **`linux/amd64`** (App Runner / Lambda), and buildx
   attestations must be disabled or pulls can fail:

   ```bash
   export AWS_PROFILE=platform-sandbox
   export AWS_REGION=us-east-2
   export REGISTRY=<account>.dkr.ecr.us-east-2.amazonaws.com
   export IDENTITY="${AWS_RESOURCE_PREFIX:-platform}"
   export TAG=sandbox-verify   # or a git SHA; pass the same tag to apps via imageTag

   aws ecr get-login-password --region "$AWS_REGION" \
     | docker login --username AWS --password-stdin "$REGISTRY"

   build_push() {
     local name="$1" file="$2"
     docker buildx build \
       --platform linux/amd64 \
       --provenance=false --sbom=false \
       -f "$file" \
       -t "$REGISTRY/$IDENTITY/$name:$TAG" \
       --push .
   }

   build_push dashboard infra/shared/docker/Dockerfile.dashboard
   build_push www infra/shared/docker/Dockerfile.www
   build_push public-api infra/shared/docker/Dockerfile.public-api
   build_push public-mcp infra/shared/docker/Dockerfile.public-mcp
   build_push workers apps/workers/Dockerfile
   build_push workers-lambda apps/workers/Dockerfile.lambda

   AWS_PROFILE=platform-sandbox pnpm infra:aws apps config set imageTag "$TAG"
   AWS_PROFILE=platform-sandbox pnpm infra:aws apps preview -s sandbox
   AWS_PROFILE=platform-sandbox pnpm infra:aws apps up -s sandbox
   ```

   `NEXT_PUBLIC_*` values are baked into Next.js images at **build** time. Rebuild
   with `--build-arg NEXT_PUBLIC_DASHBOARD_URL=https://…` (and related args) once
   you know the App Runner or custom-domain URLs; runtime App Runner env alone
   will not fix client-side links.

8. **Smoke-check apps:** After `apps up`, every App Runner service should be
   `RUNNING`. Confirm health and DB from the VPC path:

   ```bash
   # Replace hosts with `pulumi stack output` values from the apps stack
   curl -sS "https://<dashboardUrl>/api/health"   # expect {"status":"ok"}
   curl -sS "https://<dashboardUrl>/api/ready"    # expect db: true
   curl -sS "https://<wwwUrl>/api/health"
   curl -sS "https://<publicApiUrl>/health"
   curl -sS "https://<publicMcpUrl>/health"
   ```

   Auth/billing will still look broken until you replace the bootstrapping
   placeholders in `infra/aws/apps/index.ts` (or, better, Secrets Manager
   values wired via `runtimeEnvironmentSecrets`) and rebuild Next images with
   real public URLs. See [Secrets](#secrets).

> [!IMPORTANT]
> **Substitution required:** Every occurrence of `example.com` in the commands
> above is a placeholder. You must substitute your organization's real
> `AWS_DNS_ROOT_DOMAIN` value (from `infra/.env.local`) when running these
> commands. The domain and CIDRs in `infra/.env.local` are secret and must never
> be committed to version control.

---

## Part 2 — Detailed guide and mental model

### Recommended layout: one AWS account per environment

Isolating each environment in its own AWS account gives you a hard blast-radius
boundary and a clean escape hatch: **closing an account tears down every lingering
resource**, which is the simplest possible answer to orphaned-resource anxiety.

Create an **AWS Organization** from a clean management account, then add member
accounts:

```
mgmt (root, no workloads)
├── platform-state        → retained S3/KMS Pulumi state for every environment
├── platform-sandbox      → deploy stack: sandbox
├── platform-staging      → deploy stack: staging
├── platform-production   → deploy stack: production
└── (optional) platform-log-archive   → immutable HIPAA/SOC2 logs
```

Why an Organization (vs standalone accounts): consolidated billing, one-click
account closure, per-account budgets, and Service Control Policy (SCP)
guardrails (e.g. org-wide "deny public RDS", "deny disabling CloudTrail"). You
still get full isolation.

#### Which account contains what?

AWS accounts are hard visibility and permission boundaries. Being signed into
the management account does not make member-account resources appear there.

| Account    | Enter through                                                        | Resources you should expect                                                                           |
| ---------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Management | Root only for root-required work; otherwise delegated administration | Organizations, consolidated billing, agreements                                                       |
| State      | Access Portal → state account                                        | Pulumi state/audit S3 buckets, KMS keys, CloudFormation state stacks, CloudTrail                      |
| Sandbox    | Access Portal → sandbox                                              | Sandbox ECR/IAM/budget after `bootstrap`; VPC/RDS/SQS/app buckets after `core`; services after `apps` |
| Staging    | Access Portal → staging                                              | Staging copies of workload resources                                                                  |
| Production | Access Portal → production                                           | Production copies of workload resources                                                               |

The **AWS access portal is only a launcher**, not the full AWS console. Expand
an account, select its permission set, then choose **Management console**. In
the console tab that opens, always confirm the account name and 12-digit ID in
the top-right corner before inspecting or changing anything.

Using a dedicated browser profile or separate private window for administrative
sessions helps prevent confusion between management, state, and workload
accounts.

#### Global services versus regional services

- **IAM and AWS Organizations are global.** An IAM URL containing
  `region=us-east-1` is console routing context, not the location of an IAM role.
- **IAM Identity Center has a home region.** `AWS_SSO_REGION` must match it
  because Identity Center role ARNs include the home-region path outside
  `us-east-1`.
- **This project's regional AWS resources use `us-east-2` (Ohio).** That
  includes the state CloudFormation stack, KMS key, CloudTrail trail, and the
  regional location of each S3 bucket.
- The console's **Global** label identifies a global service. Lock icons in the
  region menu mean those regions are disabled for the account; the lock icon
  alone does not determine whether the current service is global.

---

### The golden rule: credentials = account

Set up one named profile per account (via IAM Identity Center / SSO is cleanest),
then **always pair the profile with the matching stack**:

```bash
# ~/.aws/config — one profile per account
[profile platform-sandbox]     # account 1111-1111-1111
[profile platform-staging]     # account 2222-2222-2222
[profile platform-production]  # account 3333-3333-3333

# Deploy: profile MUST match the stack name
AWS_PROFILE=platform-sandbox    pulumi up -s sandbox
AWS_PROFILE=platform-staging    pulumi up -s staging
AWS_PROFILE=platform-production pulumi up -s production
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

# Deployment identity + dedicated state account.
AWS_RESOURCE_PREFIX=my-company
AWS_STATE_ACCOUNT_ID=4444...
AWS_STATE_PROFILE=platform-state

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

### The config model: three places, three jobs

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

### What is manual vs. in code

| Concern                                                               | Where                                    | Why                                                                      |
| --------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| Org + member accounts                                                 | **Manual (console)**                     | Account lifecycle is a human decision; enables "close to clean up"       |
| Human/CLI access (IAM Identity Center / SSO)                          | **Manual (console)**                     | Generates the `AWS_PROFILE`s above                                       |
| BAA acceptance (AWS Artifact)                                         | **Manual (console)**                     | Legal step; required before any PHI in staging/production                |
| Anthropic first-time-use form                                         | **Manual (console)**                     | Submit once from the management account; organization members inherit it |
| Root user hardening (MFA, no keys)                                    | **Manual (console)**                     | One-time account security                                                |
| Central Pulumi state foundation                                       | **CloudFormation via `infra:aws:state`** | Must exist independently of the Pulumi stacks it stores                  |
| GitHub OIDC provider + deploy role                                    | **`bootstrap` stack**                    | Codified, repeatable per account                                         |
| ECR repositories (`<identity>/<app>`)                                 | **`bootstrap` stack**                    | Codified                                                                 |
| Cost budget + alerts                                                  | **`bootstrap` stack**                    | Codified                                                                 |
| VPC, RDS, Proxy, PgBouncer, SQS, S3, Secrets, EventBridge, compliance | **`core` stack**                         | Codified                                                                 |
| App Runner services, workers Lambda, VPC connector                    | **`apps` stack**                         | Codified                                                                 |
| Bedrock invocation logging                                            | **Manual (one CLI call)**                | Pulumi provider gap (see README)                                         |
| Third-party secret _values_                                           | **Manual (console/CLI)**                 | Never in git — see [Secrets](#secrets)                                   |

---

### One-time manual checklist (per account)

Before workload deployment, create a no-workload Organization member account
for state, assign the Identity Center administrator group, and configure a
`platform-state` SSO profile. Record only its account ID and profile name in
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

### Deploy order

Run the stacks in this order, each while authenticated to the target account.

The `pnpm infra:aws <layer> <pulumi args…>` wrapper runs `pulumi` inside the
layer directory with `infra/.env.local` loaded (so `PULUMI_ORG` / `VERCEL_*` /
account ids are present). Set `AWS_PROFILE` to match the target account. You can
also `cd` into a layer and run `pulumi` directly if you source `.env.local`
yourself.

#### 0. Central state foundation (once per environment)

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

##### Verify and connect to the state resources

The CLI is the most reliable way to confirm both ownership and access:

```bash
# State-account ownership and CloudFormation status
aws cloudformation describe-stacks \
  --stack-name <resource-prefix>-sandbox \
  --region us-east-2 \
  --profile platform-state

# State-account view of both buckets
aws s3 ls --profile platform-state

# Workload-account cross-account access and current Pulumi backend
aws s3 ls s3://<state-bucket-name>/.pulumi/ --profile platform-sandbox
AWS_PROFILE=platform-sandbox pulumi whoami -v
```

Immediately after state initialization, `.pulumi/meta.yaml` may be the only
object in the state bucket. Stack state appears after the first `stack init`.
Do not manually edit or delete anything under `.pulumi`; use the Pulumi CLI.

For a browser spot-check, enter the state account through the Access Portal and
inspect:

- **CloudFormation**: `<resource-prefix>-sandbox` is `CREATE_COMPLETE`.
- **S3**: one state bucket and one audit bucket exist.
- **KMS**: alias `alias/<resource-prefix>-sandbox` has rotation enabled.
- **CloudTrail**: `<resource-prefix>-sandbox-access` is logging.

#### 1. Bootstrap (once per account, admin credentials)

Codifies the GitHub OIDC deploy role, the ECR repo, the budget, the protected
Route 53 hosted zone, and the SNS alert topic.

```bash
pnpm --dir infra/aws install
PULUMI_SECRETS_PROVIDER='<printed awskms:///... URL>'
AWS_PROFILE=platform-sandbox pnpm infra:aws bootstrap stack init sandbox \
  --secrets-provider="$PULUMI_SECRETS_PROVIDER"
AWS_PROFILE=platform-sandbox pnpm infra:aws bootstrap config set aws:region us-east-2
AWS_PROFILE=platform-sandbox pnpm infra:aws bootstrap config set starter-aws-bootstrap:githubRepo <owner>/<repo>
AWS_PROFILE=platform-sandbox pnpm infra:aws bootstrap config set starter-aws-bootstrap:budgetNotificationEmail you@example.com
AWS_PROFILE=platform-sandbox pnpm infra:aws bootstrap preview -s sandbox
AWS_PROFILE=platform-sandbox pnpm infra:aws bootstrap up -s sandbox
```

`budgetNotificationEmail` is currently a shared notification setting: bootstrap
uses it for the AWS Budgets email notifications and subscribes the same address
to the infrastructure SNS alert topic. It is not sourced from the core stack.

Note the outputs — `deployRoleArn`, `ecrRepositoryUrl`, `hostedZoneNameServers` —
you'll feed the role/URL into GitHub Actions (`AWS_DEPLOY_ROLE_ARN`,
`AWS_ECR_REGISTRY`). The apps stack no longer needs the ECR URL as config: it
derives the registry from the deploy account + region at runtime.

**STOP:** Before deploying `core`, complete the Route 53 delegation checkpoint
described in [Part 1 — Quick runbook, section E](#e-deploy-the-sandbox-layers-in-order).
Read `hostedZoneNameServers`, create the NS record set at your external DNS
provider, verify public delegation with `dig`, and confirm the SNS subscription
email.

#### 2. Core

```bash
# AWS deps already installed via `pnpm --dir infra/aws install` above.
AWS_PROFILE=platform-sandbox pnpm infra:aws core stack init sandbox \
  --secrets-provider="$PULUMI_SECRETS_PROVIDER"
AWS_PROFILE=platform-sandbox pnpm infra:aws core config set aws:region us-east-2
AWS_PROFILE=platform-sandbox pnpm infra:aws core preview -s sandbox
AWS_PROFILE=platform-sandbox pnpm infra:aws core up -s sandbox
```

#### 3. Apps

```bash
# AWS deps already installed via `pnpm --dir infra/aws install` above.
AWS_PROFILE=platform-sandbox pnpm infra:aws apps stack init sandbox \
  --secrets-provider="$PULUMI_SECRETS_PROVIDER"
AWS_PROFILE=platform-sandbox pnpm infra:aws apps config set aws:region us-east-2
# coreStackRef comes from PULUMI_ORG; imageRegistry from the deploy account —
# no per-stack config to set here.
AWS_PROFILE=platform-sandbox pnpm infra:aws apps preview -s sandbox
AWS_PROFILE=platform-sandbox pnpm infra:aws apps up -s sandbox
```

Repeat 0–3 for `staging` and `production`, each with the matching profile and
that environment's printed KMS provider URL. If a stack already exists, use
`stack select` instead of `stack init`.

#### 4. Bedrock invocation logging (manual, once per account/region)

The pinned `@pulumi/aws` can't manage this yet, so enable it by hand — see the
command in [`README.md`](./README.md) (§Bedrock invocation logging).

---

### Troubleshooting account, region, and backend confusion

**“I created the state foundation, but the Sandbox S3 page is empty.”**

That is expected. The state and audit buckets live in the dedicated state
account. Sandbox receives workload resources only after its `bootstrap`, `core`,
and `apps` deployments.

**“The AWS access portal does not show services such as S3.”**

The portal is only a launcher. Expand the account, choose the permission set,
and select **Management console** to open the full account-scoped AWS UI.

**“The IAM or Organizations URL says `us-east-1`.”**

IAM and Organizations are global services. The URL's region parameter is
console routing context. Confirm the **Global** label in the console header.
Identity Center is different: its configured home region must match
`AWS_SSO_REGION`.

**“Regions have lock icons.”**

Those regions are disabled for the account. For this project, select Ohio
(`us-east-2`). The lock icons do not mean your IAM resources were created in
another region.

**“The state script rejects cross-account access.”**

Re-authenticate both profiles and verify their account IDs:

```bash
aws sso login --profile platform-state
aws sso login --profile platform-sandbox
aws sts get-caller-identity --profile platform-state
aws sts get-caller-identity --profile platform-sandbox
```

Also verify that `AWS_SSO_REGION` matches the Identity Center home region. The
script intentionally refuses to mutate AWS before both configured account IDs
match.

**“Pulumi is connected to an old or wrong backend.”**

Check it with:

```bash
AWS_PROFILE=platform-sandbox pulumi whoami -v
```

Re-run `pnpm infra:aws:state init sandbox` to verify access and log into the
correct backend. This is idempotent and does not initialize or deploy workload
stacks.

---

### Secrets

Two kinds of secrets, both kept out of git:

#### Derived (automatic)

`core` generates the RDS password and writes the connection-string secrets —
`/<env>/database-url`, `/<env>/direct-url`, and (hybrid)
`/<env>/vercel-database-url`. `core` also always creates
`/<env>/rds-proxy-auth` (the RDS Proxy's own database credential). You never
author or commit any of these; they're materialized at deploy time from the
generated password and resource endpoints.

#### Catalog app secrets (manual fill)

Every other app secret is driven by `infra/shared/secret-catalog.ts`
(`SECRET_CATALOG`). `core` calls `buildCatalogPlaceholderSecrets`, which creates
one `/<env>/<id>` Secrets Manager secret for **every catalog entry except
`database-url`** — today that's 7 secrets:

| id                               | env var                       | read by                                    |
| -------------------------------- | ----------------------------- | ------------------------------------------ |
| `better-auth-secret` ⚠️          | `BETTER_AUTH_SECRET`          | dashboard, public-api, public-mcp          |
| `campaign-unsubscribe-secret` ⚠️ | `CAMPAIGN_UNSUBSCRIBE_SECRET` | dashboard, www, workers                    |
| `stripe-secret-key`              | `STRIPE_SECRET_KEY`           | dashboard, public-api, public-mcp          |
| `stripe-webhook-secret`          | `STRIPE_WEBHOOK_SECRET`       | dashboard, public-api, public-mcp          |
| `resend-api-key`                 | `RESEND_API_KEY`              | dashboard, public-api, workers             |
| `openrouter-api-key`             | `OPENROUTER_API_KEY`          | dashboard, workers                         |
| `sentry-dsn`                     | `SENTRY_DSN`                  | dashboard, public-api, public-mcp, workers |

(`www` boots with no secrets at all, by design — nothing on its boot path
needs one. It reads `database-url` (not in the table above; `core` derives it)
and `campaign-unsubscribe-secret` purely at request time, for its `/email/*`
unsubscribe and click-tracking routes, which load `@workspace/campaigns` and
verify the marketing token.) Each secret is seeded with a plain-string
placeholder and created with
`ignoreChanges: ["secretString"]`, so `pulumi up` never overwrites a value
you've filled in. To add a new app secret, add an entry to `SECRET_CATALOG` —
there is no AWS-specific list to hand-maintain anymore.

Secrets are **shared** across readers: one Secrets Manager entry and one ARN
per id, referenced by every app entitled to read it (`readers` in the catalog)
— there are no per-app copies. Core exports the id → ARN map as
`catalogSecretArns` (aliased as `manualSecretArns`); the apps stack consumes it
to wire up both App Runner and the workers Lambda.

Set the real value once per environment:

```bash
aws secretsmanager put-secret-value \
  --secret-id /sandbox/stripe-secret-key \
  --secret-string 'sk_live_…'
```

**`infra:secrets:*` (`pnpm infra:secrets:status` / `infra:secrets:set`) manages
GCP Secret Manager only — it does not touch AWS.** For AWS, `put-secret-value`
above is the only path.

How the new value reaches running workloads differs by compute type:

- **App Runner** (dashboard, www, public-api, public-mcp) — services get
  `runtimeEnvironmentSecrets` pointing at the secret ARN; App Runner resolves
  the current value itself on the next deployment or instance restart. No
  Pulumi change is required.
- **Lambda** (workers) — AWS Lambda has no native secret-injection mechanism,
  so the apps stack resolves each secret's value at **deploy time**
  (`getSecretVersionOutput`) and bakes it into the function's environment
  (wrapped as a Pulumi secret so it's redacted from stack output). This means
  **after filling or rotating any secret the workers Lambda reads, you must
  re-run `pulumi up` on the apps stack** for the new value to reach the
  running Lambda — simply calling `put-secret-value` is not enough for
  workers, unlike App Runner.

#### ⚠️ `better-auth-secret` and `campaign-unsubscribe-secret` must be filled

The two ⚠️ rows in the table above. The catalog marks them `generation:
"generated"`, but that field drives **GCP only** — on AWS they are ordinary
operator-filled placeholders, seeded from `infra/shared/aws-catalog-secrets.ts`
with values that are **committed to this repository**:

```
better-auth-secret          → replace-me-better-auth-secret-min-32-chars
campaign-unsubscribe-secret → replace-me-campaign-unsubscribe-secret-min-32
```

Both seeds are long enough to pass their `.min(32)` validation, and that is
exactly the hazard: an AWS deploy where nobody ran `put-secret-value` **comes up
healthy** — containers start, health checks pass, nothing warns — while Better
Auth signs session cookies and the campaigns package signs unsubscribe links
with a key every reader of this repo already has. Those signatures are
forgeable by anyone. There is deliberately no AWS preflight check for this, and
`pnpm infra:secrets:status` is GCP-only, so **a healthy service is not evidence
these were filled.**

Filling both with real random values is **mandatory before any real traffic**,
in every environment:

```bash
for id in better-auth-secret campaign-unsubscribe-secret; do
  aws secretsmanager put-secret-value \
    --secret-id "/sandbox/$id" \
    --secret-string "$(openssl rand -base64 48)"
done
```

`campaign-unsubscribe-secret` is read by the workers Lambda, so re-run
`pulumi up` on the apps stack afterwards (per the Lambda note above).

#### Non-secret runtime env (`runtimeEnv`)

Edit non-secrets in `runtimeEnv` on `infra/aws/config.<env>.ts` (defaults in
`config.common.ts`), then `pnpm infra:aws apps up -s <env>`.

`runtimeEnv` shape:

- `shared` — hand-listed non-secrets for every app. Empty string is fine for
  “not set yet.” Keep staging and production on the **same key set**.
- `byApp` — optional per-app extras / overrides.
- `publicUrlOverrides` — optional overrides of derived public URL env vars.

**Public URLs** are derived at deploy time from `AWS_DNS_ROOT_DOMAIN` (in
gitignored `infra/.env.local`) via `buildPublicUrlEnv` — e.g. staging
`https://dashboard-staging.example.com` and production
`https://dashboard.example.com` (same flat pattern for `api` / `mcp`; www uses
`www-staging.example.com` / bare apex). Keys include `BETTER_AUTH_URL` and the
`NEXT_PUBLIC_*` URL vars. Every environment uses one Route 53 zone per public
hostname; delegate those zones with NS records at your registrar (apex/`mail`
stay there). CI must call `pnpm infra:public-urls <root> <env>` rather than
recomputing hostnames in shell.

Merge order into `runtimeEnvironmentVariables` (later wins): infra-injected
vars → derived public URLs → `publicUrlOverrides` → `shared` → `byApp[app]`.
Secret values never appear here; they come exclusively from Secrets Manager via
`runtimeEnvironmentSecrets`.

**Next.js `NEXT_PUBLIC_*`:** many client-side values are baked into the image at
**build** time. Changing runtime App Runner env alone will not fix browser
links — rebuild/push with matching `--build-arg NEXT_PUBLIC_…=https://…` when
URLs change (CI does this from `AWS_DNS_ROOT_DOMAIN`).

> [!IMPORTANT]
> **Do not edit App Runner (or Lambda) environment variables in the AWS
> console.** The next `pulumi up` on the apps stack overwrites them from
> `runtimeEnv` + derived URLs + catalog secrets. Edit config in git (or fill SM
> for secrets), then redeploy.

---

### SQS queues

Queues live in a registry: `infra/aws/core/queues.ts`. Add one by appending to
`QUEUES` — each entry gets a **dead-letter queue and redrive policy
automatically**:

```ts
export const QUEUES: readonly QueueSpec[] = [
  { key: "jobs", visibilityTimeoutSeconds: 60, maxReceiveCount: 5 },
  { key: "emails" }, // gets {prefix}-emails-<env> + {prefix}-emails-<env>-dlq
];
```

Physical names are `{prefix}-<key>-<env>` and `{prefix}-<key>-<env>-dlq` (from
`AWS_RESOURCE_PREFIX`). Every queue's URL/ARN is exported via the `queueUrls` /
`queueArns` maps for wiring.

> The `jobs` queue is load-bearing — the workers Lambda and EventBridge Scheduler
> in the `apps` stack consume it, so keep its `key` stable. A **new** queue needs
> its own consumer (event source mapping / handler) added in
> `infra/aws/apps/index.ts`.

---

### Tearing down a sandbox

Non-production stacks are disposable (no deletion protection, `forceDestroy` on
S3, 0-day secret recovery), so:

```bash
# apps, then core, then bootstrap
AWS_PROFILE=platform-sandbox pnpm infra:aws apps destroy -s sandbox
AWS_PROFILE=platform-sandbox pnpm infra:aws core destroy -s sandbox
AWS_PROFILE=platform-sandbox pnpm infra:aws bootstrap destroy -s sandbox
```

If anything is left behind, the account-per-environment layout is your safety
net: close the member account in the Organization to guarantee a clean slate.

---

### See also

- [`README.md`](./README.md) — architecture, full config reference, cost table,
  CI/CD, compliance mapping.
- [`../vercel/README.md`](../vercel/README.md) — hybrid Vercel + AWS wiring.
