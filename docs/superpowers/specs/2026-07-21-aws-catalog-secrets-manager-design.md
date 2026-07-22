# AWS catalog secrets in Secrets Manager

**Date:** 2026-07-21  
**Status:** Approved

## Overview

Wire the shared `SECRET_CATALOG` (`infra/shared/secret-catalog.ts`) into AWS so the **core** stack creates one Secrets Manager secret per catalog entry (except the already-derived `database-url`), the **apps** stack injects those secrets as runtime env vars, and multiple apps share the same secret ARN when listed as `readers`.

### Current state in this repo

| Area | Today |
| --- | --- |
| Catalog | `SECRET_CATALOG` lists 8 secrets; GCP secrets layer uses it; AWS does not |
| Core | Creates derived `/<env>/database-url`, `direct-url`, `rds-proxy-auth` (+ pooler secrets when enabled). `MANUAL_SECRETS` in `infra/aws/core/manual-secrets.ts` is **empty**; `manualSecretArns` export is `{}` |
| Placeholder seed | `buildManualSecrets` seeds **JSON** `{"placeholder":"REPLACE_IN_CONSOLE"}` — unsuitable for App Runner env injection |
| Apps | `runtimeEnvironmentSecrets` only maps `DATABASE_URL`. Plaintext boot vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BETTER_AUTH_SECRET` on every App Runner service (including `www`) |
| IAM | One shared App Runner instance role; `GetSecretValue` on `databaseUrlSecretArn` + `directUrlSecretArn` only. Workers Lambda role reads only `databaseUrlSecretArn` |
| CLI | `pnpm infra:secrets:status\|set` is **GCP-only** (`infra/scripts/secrets.ts` + `gcloud`) |
| Apps | `dashboard`, `www`, `public-api`, `public-mcp` (App Runner); `workers` (Lambda). `www` has `needsDb: false` and is **not** a catalog reader |

**Operator model:** Pulumi creates empty (placeholder) secrets and never overwrites values after you set them. You fill real values out-of-band. Pulumi does not generate random app secrets, so live sensitive values never need to live in Pulumi state.

This design closes the AWS gap without adding an AWS secrets CLI or a separate Pulumi secrets layer (unlike GCP’s `starter-gcp-secrets` project).

---

## Goals and non-goals

### Goals

- Create `/<environment>/<catalog-id>` Secrets Manager secrets for every catalog entry except `database-url`.
- Inject catalog secrets into App Runner and workers via catalog `envVar` names.
- Share one secret across many apps (same ARN on multiple services) according to `readers`.
- Expand IAM `GetSecretValue` to the secret ARNs workloads need (explicit ARN lists, not `/<env>/*` wildcards).
- Ensure `pulumi up` never clobbers operator-set secret values (`ignoreChanges` on `secretString`).
- Document the seven manual fills and the shared-secret model in `infra/aws/GETTING_STARTED.md`.

### Non-goals

- AWS parity for `pnpm infra:secrets:status|set`.
- Changing the GCP secrets layer (`infra/gcp/secrets/`) or Cloud Run wiring.
- Public URL / `NEXT_PUBLIC_*` / `BETTER_AUTH_URL` domain wiring and image rebuilds.
- Splitting the shared App Runner instance role into per-app roles (keep shared role; see IAM).
- Rotating or validating third-party key formats beyond plain-string placeholders.

---

## Architecture

```
SECRET_CATALOG (infra/shared/secret-catalog.ts)
        │
        ▼
core stack (starter-aws-core)
  • skip database-url (composed + written in core/index.ts today)
  • for every other catalog id: create SM secret at /<env>/<id>
  • seed plain-string placeholder; ignoreChanges on secretString
  • export catalogSecretArns: { [id]: arn }
  • keep manualSecretArns as alias of the same map (backward compatible)
        │
        ▼
apps stack (starter-aws-apps)
  • per App Runner service: secretsForApp(name) → runtimeEnvironmentSecrets
  • www: secretsForApp("www") is empty → no catalog SM refs (and no DATABASE_URL)
  • remove plaintext STRIPE_* / BETTER_AUTH_SECRET from runtimeEnvironmentVariables
  • shared instance role: GetSecretValue on DB ARNs + all catalogSecretArns
  • workers Lambda: deploy-time resolve for secretsForApp("workers"); IAM on those ARNs
```

Derived secrets that stay as they are (not from the app-secret builder): `database-url`, `direct-url`, `rds-proxy-auth`, and when the pooler is enabled `pooler-tls` / `vercel-database-url`.

Identity / naming (unchanged): secret paths are `/<environment>/<id>` via `deploymentNames(...).secretPathPrefix` (not prefixed with project name). Resource tags use `AWS_RESOURCE_PREFIX` / default `platform`.

---

## Core: secret creation

Replace the empty hand-maintained `MANUAL_SECRETS` list with a catalog-driven builder. Prefer evolving `infra/aws/core/manual-secrets.ts` (or a colocated successor imported from `core/index.ts`) so existing mock tests can be updated in place.

### AWS policy for catalog `generation`

On AWS, **all catalog secrets except `database-url` are treated as manually filled placeholders**, regardless of the catalog’s `generation` flag (`generated` vs `placeholder`). That flag remains meaningful for GCP (`RandomPassword` in the GCP secrets layer). AWS must not call `RandomPassword` for app secrets.

Rationale: operators own auth and third-party keys; Pulumi must not invent or rotate them; stack state must not hold live values after replace.

### Secret shape

| Field | Value |
| --- | --- |
| Name | `/<environment>/<id>` (`names.secretPathPrefix`) |
| Initial `secretString` | Plain string seed suitable for env injection — **not** JSON |
| Version options | `ignoreChanges: ["secretString"]` |
| Recovery | Non-prod: `0`; production: `7` (existing pattern) |
| Encryption | Existing CMEK when compliance enables it (`cmekKeyId`) |
| Pulumi resource names | Stable logical names (e.g. `manual-<id>` or `catalog-<id>`) |

Suggested plain-string seeds (disposable):

| id | seed |
| --- | --- |
| `better-auth-secret` | `replace-me-better-auth-secret-min-32-chars` |
| `campaign-unsubscribe-secret` | `replace-me-campaign-unsubscribe-secret-min-32` |
| `stripe-secret-key` | `sk_test_replace_me` |
| `stripe-webhook-secret` | `whsec_replace_me` |
| `resend-api-key` | `re_replace_me` |
| `openrouter-api-key` | `replace-me-openrouter` |
| `sentry-dsn` | `https://replace.me/sentry` |

### Exports

- Export `catalogSecretArns: Record<string, Output<string>>` keyed by catalog `id`.
- Keep `manualSecretArns` as the same object (or alias) so any future StackReference consumers do not break.

### Manual fill (operator)

After core deploy, set each of the seven secrets once:

| Secret id | Env var | readers (from catalog) |
| --- | --- | --- |
| `better-auth-secret` | `BETTER_AUTH_SECRET` | dashboard, public-api, public-mcp |
| `campaign-unsubscribe-secret` | `CAMPAIGN_UNSUBSCRIBE_SECRET` | dashboard, workers |
| `stripe-secret-key` | `STRIPE_SECRET_KEY` | dashboard, public-api |
| `stripe-webhook-secret` | `STRIPE_WEBHOOK_SECRET` | public-api |
| `resend-api-key` | `RESEND_API_KEY` | dashboard, public-api, workers |
| `openrouter-api-key` | `OPENROUTER_API_KEY` | dashboard, workers |
| `sentry-dsn` | `SENTRY_DSN` | dashboard, public-api, public-mcp, workers |

```bash
aws secretsmanager put-secret-value \
  --secret-id /sandbox/stripe-secret-key \
  --secret-string 'sk_live_…'
```

---

## Apps: injection and IAM

### App Runner

For each service in the existing `apprunnerApps` list (`dashboard`, `www`, `public-api`, `public-mcp`):

1. Build `runtimeEnvironmentSecrets` from `secretsForApp(app.name)`:
   - For each descriptor, map `envVar` → ARN.
   - `DATABASE_URL` uses existing `databaseUrlSecretArn` (not `catalogSecretArns`).
   - Other ids use `catalogSecretArns[id]`.
2. **www:** `secretsForApp("www")` is empty → empty catalog map. Do **not** inject `DATABASE_URL` for www (`needsDb: false`). Today www incorrectly receives `DATABASE_URL` and plaintext Stripe/auth; remove those.
3. Remove plaintext `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `BETTER_AUTH_SECRET` from `runtimeEnvironmentVariables` for all services.
4. Leave non-secret boot URLs (`BETTER_AUTH_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL`, `NEXT_PUBLIC_MCP_URL`) unchanged — out of scope.

App Runner injects each secret’s `secretString` as the env value. Shared `readers` mean the same ARN appears on multiple services — intentional (shared secrets area).

### Workers Lambda

Lambda has no `runtimeEnvironmentSecrets`. Extend the existing deploy-time resolve pattern used for `DATABASE_URL` (`getSecretVersionOutput` → `pulumi.secret(...)` env):

- Resolve every secret in `secretsForApp("workers")` (today: `DATABASE_URL`, `CAMPAIGN_UNSUBSCRIBE_SECRET`, `RESEND_API_KEY`, `OPENROUTER_API_KEY`, `SENTRY_DSN`).
- Inject as Lambda `environment.variables`.

After an operator `put-secret-value`, **re-run the apps stack** so Lambda picks up new versions. App Runner reads Secrets Manager at runtime on new instances/deploys.

### IAM

**Keep the shared App Runner instance role** (current architecture — one role for all App Runner services). Expand `secretsmanager:GetSecretValue` `Resource` to an explicit list:

- `databaseUrlSecretArn`, `directUrlSecretArn` (unchanged)
- every value in `catalogSecretArns`

That is slightly broader than least-privilege per service (www’s task role can read secrets it does not inject), but avoids a per-app role split (non-goal) and still avoids `/<env>/*` wildcards.

**Workers Lambda role:** `GetSecretValue` only on ARNs for `secretsForApp("workers")` (database URL + workers’ catalog secrets).

When CMEK is on, keep existing `kmsDecryptStatements` (ViaService `secretsmanager.<region>.amazonaws.com`).

### Safety

- `ignoreChanges` on placeholder `secretString` is load-bearing: Pulumi must never overwrite operator-set production values.
- Core does not rotate or regenerate app secrets.
- Initial placeholder strings are disposable; operators replace them before real traffic.

---

## Mapping reference

Source of truth: `infra/shared/secret-catalog.ts` (this repo). AWS creates SM entries for all rows except `database-url`.

| id | envVar | readers |
| --- | --- | --- |
| `database-url` | `DATABASE_URL` | dashboard, public-api, public-mcp, workers (derived in core) |
| `better-auth-secret` | `BETTER_AUTH_SECRET` | dashboard, public-api, public-mcp |
| `campaign-unsubscribe-secret` | `CAMPAIGN_UNSUBSCRIBE_SECRET` | dashboard, workers |
| `stripe-secret-key` | `STRIPE_SECRET_KEY` | dashboard, public-api |
| `stripe-webhook-secret` | `STRIPE_WEBHOOK_SECRET` | public-api |
| `resend-api-key` | `RESEND_API_KEY` | dashboard, public-api, workers |
| `openrouter-api-key` | `OPENROUTER_API_KEY` | dashboard, workers |
| `sentry-dsn` | `SENTRY_DSN` | dashboard, public-api, public-mcp, workers |

---

## Critical Tests

- `infra/aws/core/manual-secrets.mock.test.ts` (update / extend): catalog-driven builder creates `/<env>/<id>` for every catalog secret except `database-url`; seeds **plain-string** placeholders (assert via pure helper if mock redacts `secretString`); applies `ignoreChanges` on `secretString`; export map keys match catalog ids; does not create a second `database-url`.
- Pure helper + unit tests under `infra/aws/apps/` (e.g. `app-secrets.ts` + `app-secrets.test.ts`): `runtimeEnvironmentSecrets` for an app equals `secretsForApp` env vars mapped to shared ARNs; two apps that share a reader receive the **same** ARN; `www` gets `{}`; plaintext secret keys are not part of the helper’s variable map; IAM ARN list helpers return explicit unions (no environment-wide wildcard string).
- Optional small shared filter (e.g. `awsCatalogAppSecrets()` excluding `database-url`) colocated next to its test — `SECRET_CATALOG` remains the source of truth.

Favor fast unit/mock tests; no live AWS calls in CI. Run via package Vitest configs (`infra/aws/core`, `infra/aws/apps`).

---

## Documentation

Update `infra/aws/GETTING_STARTED.md` § Secrets:

- Distinguish derived DB/pooler secrets vs catalog app secrets.
- Replace the “edit `MANUAL_SECRETS` by hand” instructions with catalog-driven auto-create + the seven `put-secret-value` targets.
- Explain shared ARNs / multiple App Runner services reading one secret.
- Note Lambda needs an apps redeploy after fills; App Runner uses runtime SM injection.
- State explicitly that Pulumi never overwrites operator-set `secretString` values.
- Note `infra:secrets:*` remains GCP-only.

---

## Verification

- `pnpm test` in `infra/aws/core` and `infra/aws/apps` (or equivalent Vitest run for those configs)
- Typecheck/lint for touched packages if the repo scripts cover them
- Manual (post-implement, operator): after core+apps, Secrets Manager lists `/<env>/<id>` for the seven app secrets; App Runner service config shows `runtimeEnvironmentSecrets` keys matching each app’s catalog env vars; `www` has no catalog SM refs

---

## Implementation sketch (for the follow-on plan)

1. Catalog-driven builder in core (refactor `manual-secrets.ts`); plain-string seeds; `ignoreChanges`.
2. Wire builder + `catalogSecretArns` / `manualSecretArns` in `infra/aws/core/index.ts`.
3. Pure helper(s) under `infra/aws/apps/` for `runtimeEnvironmentSecrets` + IAM ARN lists.
4. Wire App Runner loop + workers Lambda + IAM in `infra/aws/apps/index.ts`; drop plaintext secret env vars; stop giving www `DATABASE_URL`.
5. Docs + critical tests above.
