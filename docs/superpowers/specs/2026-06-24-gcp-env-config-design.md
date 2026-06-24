# GCP Environment Config (Centralized Profiles)

**Date:** 2026-06-24  
**Status:** Approved

## Overview

Make first-time and repeat GCP sandbox deploys turnkey by introducing **committable, secret-free environment profiles** at `infra/gcp/config.<env>.yaml`. A new `pnpm infra:configure` command validates decisions up front (fail fast on critical items, warn on recommended), merges new defaults when infra grows, and fans out to the six existing Pulumi stack config files. Pulumi continues to read native `Pulumi.<env>.yaml` per layer; no Pulumi Cloud / ESC dependency.

This extends — does not replace — the master orchestrator (`infra/scripts/infra.ts`), six-layer architecture, and `infra/shared/secret-catalog.ts` described in [`2026-06-06-gcp-comprehensive-iac-design.md`](./2026-06-06-gcp-comprehensive-iac-design.md).

Key decisions (from brainstorming):

- **Sandbox first**, same schema generalizes to `staging` and `production`.
- **Config files at `infra/gcp/` root** — `config.sandbox.yaml`, `config.staging.yaml`, `config.production.yaml` (aligned with `--env` names).
- **No secrets in env config** — files are safe to commit for traceability; values live in Secret Manager only.
- **Tiered validation** — critical fields block; recommended fields warn; optional flags never block deploy.
- **Idempotent rerun** — `configure` merges new keys without overwriting user values; redeploy never overwrites existing secret values.
- **Pulumi ESC rejected** — incompatible with self-managed GCS state backend (locked design choice).

---

## 1. Config file layout

```
infra/gcp/
  config.sandbox.example.yaml      ← committed template
  config.staging.example.yaml
  config.production.example.yaml
  config.sandbox.yaml              ← committed (project IDs, flags — no secrets)
  config.staging.yaml
  config.production.yaml
  bootstrap/ … apps/
  README.md
```

Developers copy an example file once, then edit and commit their env config. Example files ship opinionated per-env defaults.

---

## 2. Config schema

Nested by concern (not Pulumi namespace). The configure step maps to `gcp:*` and `starter-gcp-<layer>:*` keys.

```yaml
schemaVersion: 1

gcp:
  project: "my-sandbox-proj"       # critical
  region: "us-central1"            # critical

complianceMode: "none"             # critical — propagated to all layers

bootstrap:
  privateNetwork: false
  vpcCidr: "10.10.0.0/24"
  budgetAmount: 50                 # recommended
  billingAccountId: ""             # optional
  githubRepo: ""                   # recommended for CI/WIF
  securityContactEmail: ""         # recommended when complianceMode ≠ none

database:
  tier: "db-f1-micro"
  version: "POSTGRES_16"
  availability: "ZONAL"
  pointInTimeRecovery: false

storage:
  forceDestroy: false              # sandbox may override to true for easier teardown

messaging:
  enableRedis: false
  redisTier: "BASIC"
  redisMemorySizeGb: 1

apps:
  imageTag: "latest"
  enableHttpsLb: false
  enableMonitoring: false
  lbDomain: ""                     # required when enableHttpsLb: true
  alertEmail: ""
  vpcServiceControls: false
  accessPolicyId: ""
```

**Explicitly excluded:** secret values, `PULUMI_CONFIG_PASSPHRASE`, or any third-party API keys.

### Per-env default matrix

| Field | sandbox | staging | production |
|-------|---------|---------|------------|
| `bootstrap.privateNetwork` | `false` | `true` | `true` |
| `database.tier` | `db-f1-micro` | `db-custom-2-7680` | `db-custom-2-7680` |
| `database.pointInTimeRecovery` | `false` | `false` | `true` |
| `apps.enableHttpsLb` | `false` | `false` | `true` |
| `apps.enableMonitoring` | `false` | `true` | `true` |
| `complianceMode` | `none` | `none` | `soc2` |

---

## 3. Why not Pulumi ESC?

[Pulumi ESC](https://www.pulumi.com/docs/esc/environments/) is the native centralized-env product, but stacks on **self-managed backends cannot import ESC environments**. This repo uses a GCS state bucket in the customer's project. The env config file + configure fan-out provides centralized profiles without Pulumi Cloud.

---

## 4. `configure` command

**Command:** `pnpm infra:configure --env sandbox|staging|production`

**Steps:**

1. Load `infra/gcp/config.<env>.yaml`.
2. Deep-merge with defaults from `config.<env>.example.yaml` — **fill missing keys only**; never overwrite keys the developer set.
3. Run tiered validation (§5).
4. Fan out to all six `infra/gcp/<layer>/Pulumi.<env>.yaml` files, including auto-derived `*StackRef` paths (`organization/starter-gcp-<layer>/<env>`).
5. Print summary: errors/warnings, post-deploy placeholder-secret checklist (derived from `SECRET_CATALOG`, read-only), suggested next commands.

**Merge on rerun (new infra added later):**

| Situation | Behavior |
|-----------|----------|
| New key in example defaults, absent in user config | Merged in (or printed as “add this key”) |
| Key user already set | Never overwritten |
| `schemaVersion` bump | Migration notes; new defaults merged |
| Deprecated key in user file | Warn once; ignore |

**Atomic writes:** each layer YAML written via temp file + rename so a failed run never leaves half-written config.

**Integration with existing commands:**

```text
configure  →  init  →  deploy
```

- `infra:init` should run configure first (or fail with a clear message if layer YAML is stale vs env config).
- `infra:deploy` unchanged; preflight runs after configure.

---

## 5. Validation tiers

### Configure — critical (exit non-zero)

- `gcp.project` and `gcp.region` present and valid format.
- `complianceMode` is a known enum (`none | hipaa | soc2 | hipaa+soc2`).
- Cross-field: `apps.enableHttpsLb: true` requires non-empty `apps.lbDomain`.
- Supported `schemaVersion` for this repo version.

### Configure — recommended (warn, continue)

- `bootstrap.budgetAmount` set but `billingAccountId` empty.
- `bootstrap.githubRepo` empty (CI/WIF won't work).
- `complianceMode ≠ none` but `securityContactEmail` empty.
- Sandbox guardrails: `enableHttpsLb: true` or expensive tiers in sandbox.

### Configure — never checked

- Secret values (not in config).
- Empty optional strings for non-critical flags.

### Deploy — critical GCP preflight (extends `infra/shared/preflight.ts`)

Existing checks remain: auth, billing linked, project exists, state bucket reachable.

Additional behavior:

- When `apps` is in deploy scope: **warn** if container images for `imageTag` are missing in Artifact Registry; **block** only when deploying the `apps` layer in isolation (full-stack deploy warns but proceeds so lower layers can still apply).

### Post-deploy checklist (informational)

After successful deploy, print placeholder secrets still empty, grouped by affected apps (from `SECRET_CATALOG.readers`). Never blocks.

---

## 6. Secrets (unchanged model, explicit guarantees)

Secrets are **not** in env config. Assignment is defined once in `infra/shared/secret-catalog.ts`:

- **`readers`** — which apps receive the env var and scoped `secretAccessor` IAM.
- **`generation: "generated"`** — Pulumi `secrets` layer creates `Secret` + `SecretVersion` (e.g. `database-url`, `better-auth-secret`).
- **`generation: "placeholder"`** — Pulumi creates empty `Secret` only; developer populates via `gcloud secrets versions add` after deploy.

**Per-app summary:**

| App | Runtime secrets |
|-----|-----------------|
| dashboard | DB URL, auth, campaign-unsub, Stripe, Resend, OpenRouter, Sentry |
| www | none (Sentry via build-time if used) |
| public-api | DB URL, auth, Stripe, webhook, Resend, Sentry |
| public-mcp | DB URL, auth, Sentry |
| workers | DB URL, campaign-unsub, Resend, OpenRouter, Sentry |

**Redeploy guarantees:**

- `configure` never touches Secret Manager.
- `deploy` on `secrets` layer: existing secrets in Pulumi state → no drift → left alone.
- New `SECRET_CATALOG` entry → only the new secret is created; existing values preserved.
- Manually added placeholder versions (via gcloud) are never removed by Pulumi redeploy.

**Optional helpers** (same implementation or follow-up):

- `pnpm infra:secrets:status --env <env>` — read-only; lists empty placeholders by app.
- `pnpm infra:secrets:set <secretId> --env <env>` — read value from stdin; never writes to env config or Pulumi state.

---

## 7. Developer workflow (sandbox)

```bash
# Prerequisites (manual, once): gcloud auth, GCP project, billing linked

cp infra/gcp/config.sandbox.example.yaml infra/gcp/config.sandbox.yaml
# edit gcp.project

pnpm infra:configure --env sandbox
pnpm infra:init --env sandbox
pnpm infra:deploy --env sandbox

# After deploy: populate placeholders as needed
printf '%s' 'sk_live_…' | gcloud secrets versions add stripe-secret-key --data-file=- --project <project>

pnpm infra:secrets:status --env sandbox   # optional helper
```

When new infra fields are added to the repo:

```bash
git pull
pnpm infra:configure --env sandbox   # merges new defaults, regenerates layer YAMLs
pnpm infra:deploy --env sandbox      # applies only what changed
```

---

## 8. Implementation files

| File | Purpose |
|------|---------|
| `infra/gcp/config.*.example.yaml` | Committed templates with per-env defaults |
| `infra/shared/gcp-env-config.ts` | Schema, defaults, merge, validation, fan-out mapping (pure) |
| `infra/shared/gcp-env-config.test.ts` | Unit tests |
| `infra/scripts/configure.ts` | CLI: load YAML, call pure helpers, write layer files |
| `infra/scripts/configure.test.ts` | Fan-out mapping tests (if not fully covered in shared) |
| `infra/scripts/infra.ts` | Wire init → configure; extend deploy preflight warnings |
| `package.json` | `"infra:configure": "tsx infra/scripts/configure.ts"` |
| `infra/gcp/README.md` | Update TL;DR to lead with env config |

Layer Pulumi programs (`infra/gcp/*/index.ts`) require **no runtime changes** — they continue reading stack config set by fan-out.

---

## Critical Tests

- `infra/shared/gcp-env-config.test.ts`:
  - **Merge** — deep-merge fills missing keys from example defaults; never overwrites user-set values; handles nested `bootstrap`/`database`/etc.
  - **Validation tiers** — missing `gcp.project` fails critical; empty `githubRepo` warns only; `enableHttpsLb: true` without `lbDomain` fails critical.
  - **Fan-out mapping** — sandbox input produces correct `starter-gcp-bootstrap:*`, `starter-gcp-database:*`, … keys and `organization/starter-gcp-<layer>/<env>` stack refs for all six layers.
  - **Compliance propagation** — single top-level `complianceMode` maps to every layer's config key.
  - **Schema version** — unsupported `schemaVersion` fails with actionable error.
- `infra/scripts/configure.test.ts` (or extend orchestration tests):
  - **Atomic write contract** — fan-out output for a fixture config matches golden YAML per layer (snapshot or explicit string compare).
- `infra/scripts/orchestration.test.ts` (extend if needed):
  - **Init ordering** — document/verify init invokes configure or rejects stale layer YAML.

Avoid testing Pulumi or gcloud I/O in unit tests; live behavior is exercised by manual sandbox deploy and existing `infra:test:ephemeral`.

---

## Verification

- `pnpm test` (includes new `gcp-env-config` tests)
- `pnpm type-check`
- `pnpm lint`
- Manual: `pnpm infra:configure --env sandbox` on example config → diff six `Pulumi.sandbox.yaml` files
- Manual: first sandbox deploy following updated `infra/gcp/README.md`

---

## Out of scope

- Pulumi ESC / Pulumi Cloud backend migration.
- Storing secret values in env config or committed files.
- Automating GCP project creation or billing link (remain manual prerequisites).
- Renaming env aliases (`dev`/`prod`) — stack names stay `sandbox|staging|production`.

---

## Related docs

- [`2026-06-06-gcp-comprehensive-iac-design.md`](./2026-06-06-gcp-comprehensive-iac-design.md) — layer architecture, secrets catalog, orchestrator
- [`infra/gcp/README.md`](../../infra/gcp/README.md) — operator guide (to be updated during implementation)
