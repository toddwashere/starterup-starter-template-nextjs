# Dashboard Playwright E2E — Design

**Date:** 2026-05-25  
**Status:** Approved

## Overview

Add browser end-to-end smoke tests for `apps/dashboard` using Playwright. Tests exercise real auth cookies, Next.js routing, React Query, modals, and server actions against a seeded Postgres database. v1 ships **eight P0 smokes** plus infrastructure to run locally (Approach A) and in a **separate, opt-in CI job** (Approach B). Main CI (`ci.yml`) remains unchanged (no seed, no Playwright).

Vitest already covers server actions, proxy redirects, and layout guards with mocks. Playwright closes integration gaps those tests cannot see.

---

## Decisions

| Topic | Decision |
|-------|----------|
| **Scope** | `apps/dashboard` only |
| **Test count (v1)** | 8 P0 smokes (see suite table below) |
| **Runner entrypoint** | `apps/dashboard/e2e/run-e2e.mts` (not repo-root `scripts/`) |
| **Config** | `apps/dashboard/e2e/playwright.config.ts` |
| **App under test** | `next start` on port **4000** (production server, not `next dev`) |
| **Database** | Same as CI/dev: custom `docker/postgres`, DB `app_db`, `migrate deploy` + **seed** before E2E |
| **Seed users** | `user@example.com` / `password123`, org `acme-inc` (existing `packages/database/prisma/seed.ts`) |
| **Browsers (v1)** | Chromium only |
| **Workers** | `1` in CI; local default `1` (avoid shared-DB races) |
| **Local default** | E2E available via `pnpm test:e2e` |
| **Local bypass** | `E2E_DISABLED=1` → skip with exit **0** and clear message |
| **CI default** | E2E job **skipped** until repo variable `E2E_CI_ENABLED=true` |
| **CI bypass (when on)** | PR title or commit message contains `[skip e2e]` |
| **CI workflow** | Separate `.github/workflows/e2e.yml` (parallel to `ci.yml`) |
| **Main CI seed** | Still **no** — seed only in E2E job |
| **Selectors** | Prefer `getByRole` / labels; add minimal `data-testid` on unstable controls |
| **Stripe / LLM** | Out of scope for v1 E2E |

---

## Scope

### In scope

- Playwright devDependency on `@apps/dashboard`
- `e2e/` folder: `run-e2e.mts`, `playwright.config.ts`, `auth.setup.ts`, `smoke.spec.ts`, `helpers/`
- Root `package.json` script: `test:e2e` → filter dashboard
- Dashboard `package.json` scripts: `test:e2e`, `test:e2e:headed`, `test:e2e:ui`
- Minimal `data-testid` on sign-in, org picker, add-contact, contact row link
- `.github/workflows/e2e.yml` with `if: vars.E2E_CI_ENABLED == 'true'`
- README section: prerequisites, run, skip, enable/disable CI
- `.env.example` commented `E2E_DISABLED` line (dashboard or root)

### Out of scope (v1)

- P1 expansion tests (create-org, billing, AI send, cross-org, etc.) — documented as follow-up
- `www`, `public-api`, workers E2E
- Playwright in required `ci.yml` job
- Stripe checkout / portal redirects
- AI streaming / tool calls
- Mobile viewport matrix
- Visual regression / snapshots
- GHCR-cached Postgres image (document as CI optimization follow-up)
- Reusing build artifacts from `ci.yml` (follow-up)

---

## Dependencies

| Spec / doc | Relationship |
|------------|----------------|
| [CI workflows](./2026-05-23-ci-workflows-design.md) | E2E job mirrors Postgres + migrate pattern; adds **seed** |
| [Typed env](./2026-05-23-typed-env-validation-design.md) | `DATABASE_URL`, auth URLs for running dashboard |
| `packages/database/prisma/seed.ts` | Deterministic E2E fixtures |
| `.ai/skills/add-new-page/SKILL.md` | E2E only for critical journeys; Vitest for actions |

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│  Developer / CI                                                  │
│    pnpm test:e2e  →  apps/dashboard/e2e/run-e2e.mts             │
│      │ if E2E_DISABLED → exit 0 (skip)                         │
│      └→ playwright test -c e2e/playwright.config.ts            │
└────────────────────────────┬────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
  auth.setup.ts        smoke.spec.ts      helpers/*.ts
  (storageState)       (8 P0 tests)       login, gotoOrg, …
         │                   │
         └─────────┬─────────┘
                   ▼
         http://localhost:4000  (next start)
                   │
                   ▼
         Postgres app_db (seeded)
```

**CI (`e2e.yml`):** Runs only when `vars.E2E_CI_ENABLED == 'true'`. Same Postgres docker build as `ci.yml`, then migrate + seed, build dashboard, install Chromium, start app, `E2E_CI=1 pnpm test:e2e`. Upload Playwright report on failure.

---

## File structure

```text
apps/dashboard/
  e2e/
    run-e2e.mts              # E2E_DISABLED gate; spawns Playwright CLI
    playwright.config.ts
    auth.setup.ts            # owner storageState from seed user
    smoke.spec.ts            # P0 suite
    helpers/
      auth.ts
      org.ts
      contacts.ts
  package.json               # test:e2e scripts, @playwright/test

.github/workflows/
  e2e.yml

package.json                 # test:e2e → pnpm --filter @apps/dashboard test:e2e

README.md                    # E2E section
.env.example                 # # E2E_DISABLED=1
```

`run-e2e.mts` is **not** matched by Playwright (`testMatch: **/*.spec.ts` only).

---

## Bypass and enable controls

### Local: `E2E_DISABLED`

| Value | Behavior |
|-------|----------|
| unset | Run Playwright |
| `1` or `true` (case-insensitive) | Print skip message, **exit 0** |

Set via env or `.env` / `.env.local` (dotenv loaded by dashboard dev; `run-e2e.mts` reads `process.env`).

Convenience:

```bash
E2E_DISABLED=1 pnpm test:e2e
```

### CI: `E2E_CI_ENABLED` (repository variable)

| Value | Behavior |
|-------|----------|
| unset / not `true` | Entire `e2e` workflow job skipped |
| `true` | Job runs |

Enable: GitHub → Settings → Actions → Variables → `E2E_CI_ENABLED` = `true`.  
Do **not** add `e2e` to required checks until stable.

### CI emergency: `[skip e2e]`

When CI is enabled, skip if PR **title** or **head commit message** contains `[skip e2e]` (document for maintainers only).

### CI stricter mode: `E2E_CI=1`

Set in `e2e.yml` only. Playwright config may use: `retries: 2`, `forbidOnly: true`, `trace: on-first-retry`. Local runs omit `E2E_CI` for faster feedback.

---

## P0 smoke suite

| ID | Spec describe / test name | Proves |
|----|---------------------------|--------|
| A1 | unauthenticated protected route | `/acme-inc/contacts` → `/sign-in` with `redirectTo` |
| A2 | sign in | `user@example.com` → org picker shows Acme |
| B1 | enter organization | Click Acme → `/acme-inc` + sidebar |
| C1 | sidebar navigation | Contacts, AI, Settings → Members load (no crash) |
| D1 | contacts list | `/acme-inc/contacts` renders table or empty state |
| D2 | create contact | Add contact modal → save → row visible |
| D3 | contact detail | Open contact → detail URL + display name |
| E4 | API key create | Settings → API Keys → create → name in list |

Alternative for E4 if API keys UI is slow to stabilize: **E8** billing page renders plan section (no Stripe redirect).

Use **one worker**, serial tests, `storageState` from `auth.setup.ts` for tests after A2.

---

## `data-testid` conventions (v1)

| Element | `data-testid` |
|---------|----------------|
| Sign-in form | `sign-in-form` |
| Org picker card (per slug) | `org-picker-{slug}` e.g. `org-picker-acme-inc` |
| Contacts “Add” trigger | `contacts-add` |
| First contact link in list | `contact-row-0` (or dynamic id when known) |
| Sidebar link (optional) | `nav-contacts`, `nav-ai`, `nav-settings-members` |

Prefer roles where stable (`getByRole('button', { name: 'Sign in' })`).

---

## Playwright config (summary)

| Option | Local | `E2E_CI=1` |
|--------|-------|------------|
| `baseURL` | `http://localhost:4000` | same |
| `testDir` | `./` (under `e2e/`) | same |
| `testMatch` | `**/*.spec.ts` | same |
| `workers` | 1 | 1 |
| `retries` | 0 | 2 |
| `forbidOnly` | false | true |
| `projects` | `setup` → `chromium` (storageState) | same |
| `webServer` | **disabled in CI** (workflow starts app); **enabled locally** optional | |

**Local `webServer` (recommended):** Document manual start OR config `webServer` that runs `pnpm start` if port 4000 free — implementation plan chooses one path; CI always starts server in workflow for clarity.

---

## Developer workflow

**Prerequisites**

1. Postgres running (`docker compose up -d postgres` or CI image).
2. Root `.env` with `DATABASE_URL`, auth URLs (see `.env.example`).
3. `pnpm --filter @workspace/database exec prisma migrate deploy`
4. `pnpm --filter @workspace/database db:seed`

**Run**

```bash
pnpm --filter @apps/dashboard build
pnpm --filter @apps/dashboard start   # port 4000, separate terminal
pnpm test:e2e
```

Or use Playwright `webServer` after build (document in README).

**Skip**

```bash
E2E_DISABLED=1 pnpm test:e2e
```

**Debug**

```bash
pnpm --filter @apps/dashboard test:e2e:headed
pnpm --filter @apps/dashboard test:e2e:ui
```

---

## CI workflow (`e2e.yml`) outline

- **Trigger:** `pull_request`, `push` to `main`
- **Condition:** `vars.E2E_CI_ENABLED == 'true'` and not `[skip e2e]`
- **Timeout:** 25 minutes
- **Steps:** checkout → pnpm → docker postgres → migrate → **seed** → build dashboard → cache Playwright → `playwright install chromium` → start `next start` → wait-on 4000 → `E2E_CI=1 pnpm test:e2e` → upload report on failure

**Estimated duration when enabled:** ~8–15 min (warm cache); ~12–18 min cold Docker build.

---

## Critical Tests

E2E is the primary test surface for this spec. Colocated Playwright specs:

- `apps/dashboard/e2e/smoke.spec.ts`: A1 unauthenticated redirect with `redirectTo`; A2 sign-in lands on org picker; B1 enter `acme-inc`; C1 sidebar routes load; D1 contacts list; D2 create contact appears in list; D3 contact detail; E4 create API key listed.
- `apps/dashboard/e2e/auth.setup.ts`: seed user sign-in produces valid `storageState` at `e2e/.auth/user.json`.
- `apps/dashboard/e2e/run-e2e.mts`: when `E2E_DISABLED=1`, exits 0 without invoking Playwright; otherwise runs CLI (smoke test via manual/optional script test in plan).

No new Vitest coverage required unless `run-e2e` gate logic is extracted for unit testing.

---

## Verification

- Local: migrate + seed → build → start → `pnpm test:e2e` (all 8 pass)
- Local skip: `E2E_DISABLED=1 pnpm test:e2e` exits 0, no browser
- CI off: push without `E2E_CI_ENABLED` → `e2e` job skipped
- CI on: set variable → job green on `main`
- Existing `pnpm test` / `ci.yml` unchanged

---

## Follow-ups (post-v1)

| Item | Notes |
|------|--------|
| **Phase 2 E2E** | [Phase 2 design](./2026-05-26-dashboard-playwright-e2e-phase-2-design.md) — tags, manifest, `db:seed:e2e`, nightly |
| GHCR Postgres image | Shave 2–4 min off E2E CI (phase 2 plan 2B) |
| Artifact reuse | Share `apps/dashboard/.next` from `ci.yml` |
| Required check | After 1–2 weeks stable, require `e2e` in branch protection (documented in phase 2) |
| `test.only` in CI | Already `forbidOnly` when `E2E_CI=1` |

---

## Relationship to Vitest

| Concern | Vitest | Playwright |
|---------|--------|------------|
| `contact-actions` permissions | mocked | — |
| `proxy.ts` redirects | unit | A1 full stack |
| Layout clear-session | unit | — |
| Modal + list refresh | — | D2 |
| Org picker + `setActive` | — | B1 |

Do not remove Vitest tests when adding E2E.
