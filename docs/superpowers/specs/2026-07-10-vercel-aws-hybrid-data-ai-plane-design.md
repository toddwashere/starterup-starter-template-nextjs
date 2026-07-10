# Vercel + AWS Hybrid Data/AI Plane

**Date:** 2026-07-10
**Status:** Draft

## Overview

Run the web apps on **Vercel** while the **data and AI plane lives in AWS**: Postgres (pooled, hundreds of connections), S3, SQS, and Amazon Bedrock — all HIPAA-logged. **Vercel Secure Compute is out of scope** (quoted at ~$20k/mo). Instead, Vercel reaches AWS the way any external client does: over public endpoints authenticated with short-lived **IAM credentials via Vercel OIDC federation** (no long-lived keys, no VPC peering).

Most of the AWS plane already exists in Pulumi (`infra/aws/core` + `infra/aws/apps`). This spec adds the four pieces needed to make it consumable from Vercel and to run Bedrock.

### Key architectural facts

- **S3, SQS, Bedrock, Secrets Manager are public-API + IAM services.** Vercel calls them directly with assumed-role credentials — no networking changes.
- **RDS Proxy cannot be public.** The Vercel→Postgres pooled path therefore uses a **public PgBouncer listener that runs inside the VPC** and fronts the **private** RDS. RDS and RDS Proxy stay private; PgBouncer is the only public database surface. In-AWS compute (workers Lambda) keeps using the private RDS Proxy.
- **`complianceMode: "hipaa"`** drives the audit/logging bundle already built in `infra/aws/core/compliance-resources.ts` (CloudTrail data events, VPC Flow Logs, CMEK, immutable log bucket, Config rules).
- **BAAs:** AWS BAA is free via AWS Artifact; Vercel BAA comes with its HIPAA plan.

### Decisions (locked)

- Pooling: **public PgBouncer** (transaction mode) in front of private RDS.
- Public DB endpoint: **all environments** (sandbox, staging, production).
- Vercel→AWS auth: **OIDC federation → assumed IAM role** (no static keys).
- Bedrock: **included now**.

### Non-goals

- Vercel Secure Compute / VPC peering (explicitly excluded).
- Moving web apps to AWS App Runner (the App Runner profile remains available but unused in the hybrid).
- Replacing RDS Proxy (kept for in-VPC consumers).

---

## 1. Vercel → AWS access (OIDC federation)

- Create an **IAM OIDC identity provider** for Vercel: issuer `https://oidc.vercel.com/<team-slug>`, audience `https://vercel.com/<team-slug>`.
- Create an **IAM role** Vercel assumes, with a trust policy conditioned on the Vercel `sub` claim (`owner:<team>:project:<project>:environment:<env>`) so only your project/environment can assume it.
- Attach a **least-privilege policy**: `s3:{Get,Put,Delete}Object` + `s3:ListBucket` on the uploads bucket; `sqs:SendMessage` on the jobs queue; `secretsmanager:GetSecretValue` on the app secrets; `bedrock:InvokeModel` + `bedrock:InvokeModelWithResponseStream` on the allowed model ARNs; `kms:Decrypt` (ViaService) when CMEK is on.
- App side: use `@vercel/functions/oidc` `awsCredentialsProvider({ roleArn })` to obtain credentials for the AWS SDK clients (S3, SQS, Bedrock). No access keys in env.
- Export the role ARN from `core` for wiring into Vercel project env (`AWS_ROLE_ARN`).

## 2. Postgres — public pooled via in-VPC PgBouncer

Topology (constant across envs; the public surface is PgBouncer, not RDS):

```
Vercel functions ──TLS──▶ NLB (public subnets) ──▶ PgBouncer (Fargate, private subnets, transaction mode) ──TLS──▶ RDS Postgres (private)
in-AWS Lambda / App Runner ─────────────────────────────────▶ RDS Proxy (private) ──▶ RDS Postgres (private)
```

- **PgBouncer** runs as an ECS Fargate service (2 tasks across AZs for HA) in private subnets, transaction pooling mode, fronted by a **public Network Load Balancer** on port 6432.
- **TLS both sides:** `client_tls_sslmode=require` (server cert presented to Vercel) and `server_tls_sslmode=require` to RDS. Clients use `sslmode=verify-full`.
- **Auth:** PgBouncer `auth_query` against Postgres, or a userlist sourced from Secrets Manager. Credentials live in Secrets Manager.
- **Security groups:** NLB/PgBouncer listener open on 6432 (TLS) to `0.0.0.0/0` (Vercel egress is dynamic — no IP allow-list without Secure Compute); PgBouncer → RDS on 5432 within `db-sg`.
- **RDS stays private** (`publiclyAccessible: false`) — no change to that flag. This meets "public pooled database" while keeping the instance itself off the internet.
- **Connections:** PgBouncer collapses hundreds of Vercel client connections onto a small backend pool; size `default_pool_size` and RDS `max_connections` per env (see the 400-connection sizing note in the App Runner spec).
- New secret `DATABASE_URL` for Vercel points at the **NLB DNS:6432**; `DIRECT_URL` (migrations) points at the RDS instance via the CI tunnel.
- **HIPAA note:** PgBouncer is in the PHI path — it must be patched, HA, and TLS-terminated. Documented as an owned component.

## 3. Amazon Bedrock (AI models)

- `packages/ai` currently supports openai/anthropic/openrouter/ollama/openai-compatible in `get-model.ts`. Add a **`bedrock`** provider case using `@ai-sdk/amazon-bedrock` (`createAmazonBedrock`).
- Credentials: on Vercel, pass `credentialProvider: awsCredentialsProvider({ roleArn })`; in-AWS (Lambda/App Runner), use the default credential chain (task role). Region from config.
- Add Bedrock model entries to `packages/ai/src/platform/models/ai-models-available.ts` (e.g. `bedrock:anthropic.claude-3-5-sonnet-*`).
- Add keys to `packages/ai/keys.ts`: `AWS_REGION` and (Vercel) `AWS_ROLE_ARN`; no Bedrock API key (IAM-based).
- IAM: `bedrock:InvokeModel*` on the Vercel role and any in-AWS role that calls AI server-side.
- **HIPAA:** Bedrock is HIPAA-eligible under the AWS BAA; inputs/outputs are not used for training. Restrict to eligible models. In-VPC callers may use a Bedrock **Interface VPC endpoint** (PrivateLink) — gated by the existing `vpcServiceControls`/interface-endpoints compliance flag.

## 4. Compliance & logging

- Set `complianceMode: "hipaa"` on the environments handling PHI. This activates (already built): CloudTrail with data events (S3, Secrets Manager), VPC Flow Logs, CMEK across RDS/S3/SQS/Secrets/Logs, Object-Lock immutable log bucket, and AWS Config rules.
- Extend CloudTrail/Config coverage to the new PgBouncer NLB + Bedrock invocation logging (Bedrock model invocation logging to CloudWatch/S3).
- Keep the non-prod data-safety gating (already added): non-prod is disposable, prod protected.

## 5. New config surface

Add to `infra/shared/aws-env-config.ts` (and per-env files):

- `database.pooler: { enabled: boolean; publicListener: boolean; poolSize: number }` — enable the public PgBouncer.
- `ai: { bedrockRegion: string; bedrockModels: string[] }` — Bedrock region + allowed models for IAM scoping.
- `access: { vercelOidc: { teamSlug: string; projectName: string } }` — to build the OIDC provider + role trust policy.

---

## Critical Tests

- `packages/ai/src/platform/get-model.test.ts`: `bedrock:<model>` constructs a Bedrock `LanguageModel`; missing `AWS_REGION` (and, on Vercel, missing `AWS_ROLE_ARN`) throws a readable error; unknown model id is rejected.
- `packages/ai/src/platform/models/ai-models-available.test.ts`: Bedrock catalog entries parse via `parseProviderModelValue` and appear in the available-models list.
- `infra/shared/aws-env-config.test.ts`: `database.pooler.enabled` and `access.vercelOidc` resolve per env; all three envs expose the pooler (public endpoint everywhere per decision).
- `infra/aws/core/vercel-access.mock.test.ts`: the Vercel IAM role policy grants **only** S3(uploads)/SQS(jobs)/Secrets(app)/Bedrock(models) and the trust policy is scoped to the Vercel `sub` claim (no wildcard principal).
- `infra/aws/core/pgbouncer.mock.test.ts`: PgBouncer service targets private subnets, the NLB listener is public on 6432, and `db-sg` allows PgBouncer→RDS on 5432; RDS `publiclyAccessible` remains `false`.
- `infra/aws/core/compliance-resources.test.ts` (existing, regression): `hipaa` enables CloudTrail/Flow Logs/CMEK/Object-Lock; `none` is a no-op.

## Verification

- `pnpm type-check`
- `pnpm lint`
- `pnpm --filter @workspace/ai test`
- `pnpm --filter ./infra/... test`
- `cd infra/aws/core && pulumi preview -s sandbox` (shows PgBouncer NLB/service, Vercel OIDC role, Bedrock IAM; RDS still private)
- Manual: from a Vercel preview, assume-role → `PutObject` to S3, `SendMessage` to SQS, `InvokeModel` to Bedrock, and a pooled query via the PgBouncer endpoint.
