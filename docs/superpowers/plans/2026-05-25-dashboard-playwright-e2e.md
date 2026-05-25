# Dashboard Playwright E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Playwright P0 smoke tests for `apps/dashboard` with local `pnpm test:e2e`, opt-out via `E2E_DISABLED`, and opt-in CI via `E2E_CI_ENABLED`.

**Architecture:** Colocated `apps/dashboard/e2e/` holds `run-e2e.mts`, Playwright config, auth setup, and specs. Root delegates with pnpm filter. Separate `e2e.yml` mirrors Postgres + migrate + **seed** + build + `next start`, gated by repository variable.

**Tech Stack:** `@playwright/test`, Next.js 16, Better Auth seed users, existing Prisma seed.

**Design spec:** [`docs/superpowers/specs/2026-05-25-dashboard-playwright-e2e-design.md`](../specs/2026-05-25-dashboard-playwright-e2e-design.md)

---

## File Structure

| Action | Path |
|--------|------|
| Create | `apps/dashboard/e2e/run-e2e.mts` |
| Create | `apps/dashboard/e2e/playwright.config.ts` |
| Create | `apps/dashboard/e2e/auth.setup.ts` |
| Create | `apps/dashboard/e2e/smoke.spec.ts` |
| Create | `apps/dashboard/e2e/helpers/auth.ts` |
| Create | `apps/dashboard/e2e/helpers/org.ts` |
| Create | `apps/dashboard/e2e/helpers/contacts.ts` |
| Create | `apps/dashboard/e2e/.gitignore` (`.auth/`, `test-results/`, `playwright-report/`) |
| Create | `.github/workflows/e2e.yml` |
| Modify | `apps/dashboard/package.json` |
| Modify | `package.json` (root `test:e2e`) |
| Modify | `README.md` |
| Modify | `.env.example` |
| Modify | Sign-in / org picker / contacts UI (minimal `data-testid`) |

---

## Critical Tests

- `apps/dashboard/e2e/smoke.spec.ts`: full P0 suite per design table (A1, A2, B1, C1, D1, D2, D3, E4).
- `apps/dashboard/e2e/auth.setup.ts`: `user@example.com` login writes `e2e/.auth/user.json`.
- `apps/dashboard/e2e/run-e2e.mts`: `E2E_DISABLED=1` exits 0 without running Playwright.

---

## Task 1: Playwright dependencies and scripts

**Files:**

- Modify: `apps/dashboard/package.json`
- Modify: `package.json`

- [ ] **Step 1:** Add devDependencies to `@apps/dashboard`: `@playwright/test` (match monorepo major, e.g. ^1.51).

- [ ] **Step 2:** Add dashboard scripts:

  ```json
  "test:e2e": "tsx e2e/run-e2e.mts",
  "test:e2e:headed": "tsx e2e/run-e2e.mts -- --headed",
  "test:e2e:ui": "tsx e2e/run-e2e.mts -- --ui"
  ```

  Add `tsx` devDependency if not present on dashboard.

- [ ] **Step 3:** Root `package.json`:

  ```json
  "test:e2e": "pnpm --filter @apps/dashboard test:e2e"
  ```

- [ ] **Step 4:** Run `pnpm install` from repo root.

---

## Task 2: `run-e2e.mts` gate and launcher

**Files:**

- Create: `apps/dashboard/e2e/run-e2e.mts`
- Create: `apps/dashboard/e2e/.gitignore`

- [ ] **Step 1:** Implement skip gate:

  ```typescript
  const disabled = process.env.E2E_DISABLED;
  if (disabled === "1" || disabled?.toLowerCase() === "true") {
    console.log("E2E skipped (E2E_DISABLED is set).");
    process.exit(0);
  }
  ```

- [ ] **Step 2:** Spawn `playwright test` with `-c e2e/playwright.config.ts`, forward `process.argv.slice(2)` after `--` for headed/ui/extra args. Use `child_process.spawnSync` with `stdio: inherit`, `cwd` = dashboard app root (`import.meta` dirname parent).

- [ ] **Step 3:** Exit with Playwright’s exit code.

- [ ] **Step 4:** `.gitignore` under `e2e/`: `.auth/`, `test-results/`, `playwright-report/`, `blob-report/`.

---

## Task 3: Playwright config and auth setup

**Files:**

- Create: `apps/dashboard/e2e/playwright.config.ts`
- Create: `apps/dashboard/e2e/auth.setup.ts`
- Create: `apps/dashboard/e2e/helpers/auth.ts`

- [ ] **Step 1:** `playwright.config.ts`:

  - `testDir: '.'` (file lives in `e2e/`)
  - `testMatch: '**/*.spec.ts'` (excludes `run-e2e.mts`)
  - `baseURL: 'http://127.0.0.1:4000'`
  - `workers: 1`
  - `retries: process.env.E2E_CI ? 2 : 0`
  - `forbidOnly: !!process.env.E2E_CI`
  - `trace: 'on-first-retry'` when `E2E_CI`
  - Projects: `setup` (`auth.setup.ts`), `chromium` depends on setup, `storageState: '.auth/user.json'`
  - Optional local `webServer`: `command: 'pnpm start'`, `port: 4000`, `reuseExistingServer: true` — only if not already running

- [ ] **Step 2:** `helpers/auth.ts` — `signIn(page, { email, password })` using sign-in form roles/testids.

- [ ] **Step 3:** `auth.setup.ts` — sign in as `user@example.com` / `password123`, save storage to `e2e/.auth/user.json`.

- [ ] **Step 4:** Manual verify: migrate + seed, build, start, `pnpm --filter @apps/dashboard exec playwright test -c e2e/playwright.config.ts --project=setup`.

---

## Task 4: Minimal `data-testid` hooks in UI

**Files:**

- Modify: `apps/dashboard/features/auth/ui/sign-in-page-content.tsx` — `data-testid="sign-in-form"` on `<form>`
- Modify: `apps/dashboard/features/dashboard/ui/org-picker-page-content.tsx` — `data-testid={`org-picker-${slug}`}` on org card/button
- Modify: `apps/dashboard/features/contacts/contact/ui/contacts-page-content.tsx` — `data-testid="contacts-add"` on add button
- Modify: contact list row link (table or card) — `data-testid` with contact id or index `contact-row-0` for first row after create

- [ ] **Step 1:** Add testids without changing layout/styling.

- [ ] **Step 2:** Run `pnpm --filter @apps/dashboard lint`.

---

## Task 5: Helpers and P0 smoke spec

**Files:**

- Create: `apps/dashboard/e2e/helpers/org.ts`
- Create: `apps/dashboard/e2e/helpers/contacts.ts`
- Create: `apps/dashboard/e2e/smoke.spec.ts`

- [ ] **Step 1:** `org.enterOrg(page, 'acme-inc')` — click `org-picker-acme-inc`, expect URL `/acme-inc`.

- [ ] **Step 2:** `contacts.createContact(page, { displayName })` — open add modal, fill required fields, submit, expect row.

- [ ] **Step 3:** Implement tests:

  | Test | Project | Notes |
  |------|---------|-------|
  | A1 redirect | no storage | fresh context |
  | A2 sign-in | no storage | see org picker |
  | B1–E4 | chromium | use storageState |

- [ ] **Step 4:** E4 — navigate to API keys, create key with unique name, expect list row.

- [ ] **Step 5:** Run full suite locally: `pnpm test:e2e`. Fix flakes (explicit `expect` waits, no `sleep` unless necessary).

- [ ] **Step 6:** Run `E2E_DISABLED=1 pnpm test:e2e` — confirm exit 0 and message.

---

## Task 6: CI workflow (opt-in)

**Files:**

- Create: `.github/workflows/e2e.yml`

- [ ] **Step 1:** Job `e2e` with:

  ```yaml
  if: |
    vars.E2E_CI_ENABLED == 'true' &&
    !contains(github.event.pull_request.title, '[skip e2e]') &&
    !contains(github.event.head_commit.message, '[skip e2e]')
  ```

  (Adjust `head_commit` access for `pull_request` vs `push` events per GitHub Actions docs.)

- [ ] **Step 2:** Copy Postgres docker build + `pg_isready` loop from `ci.yml`.

- [ ] **Step 3:** `prisma migrate deploy` + `pnpm --filter @workspace/database db:seed`.

- [ ] **Step 4:** `pnpm --filter @apps/dashboard build`.

- [ ] **Step 5:** Cache Playwright browsers (`~/.cache/ms-playwright`).

- [ ] **Step 6:** `pnpm exec playwright install --with-deps chromium` from `apps/dashboard`.

- [ ] **Step 7:** Start `pnpm --filter @apps/dashboard start` in background; `npx wait-on http://127.0.0.1:4000`.

- [ ] **Step 8:** `env: E2E_CI: 1` + `pnpm test:e2e`.

- [ ] **Step 9:** Upload `apps/dashboard/playwright-report` on failure.

- [ ] **Step 10:** Document: leave `E2E_CI_ENABLED` unset until smoke is stable; then set to `true`.

---

## Task 7: Documentation

**Files:**

- Modify: `README.md`
- Modify: `.env.example`

- [ ] **Step 1:** README **E2E tests** section: prerequisites (postgres, migrate, seed), run, skip (`E2E_DISABLED`), debug (headed/ui), enable CI (`E2E_CI_ENABLED`), `[skip e2e]`, estimated CI time.

- [ ] **Step 2:** CI section bullet: optional parallel E2E workflow (link spec).

- [ ] **Step 3:** `.env.example` add commented `# E2E_DISABLED=1`.

- [ ] **Step 4:** Update `docs/superpowers/specs/2026-05-23-ci-workflows-design.md` follow-ups — mark Playwright as addressed (link new spec) — optional one-line cross-link only.

---

## Task 8: Final verification

- [ ] `pnpm lint` and `pnpm type-check` pass.
- [ ] `pnpm test` unchanged (no regressions).
- [ ] Local: 8/8 E2E pass with seed data.
- [ ] Local: `E2E_DISABLED=1` skips.
- [ ] Push branch: without `E2E_CI_ENABLED`, e2e job skipped.
- [ ] (Maintainer) Set `E2E_CI_ENABLED=true` once — job passes.

---

## Spec coverage self-check

| Design item | Plan task |
|-------------|-----------|
| `e2e/run-e2e.mts` | Task 2 |
| `E2E_DISABLED` | Task 2, 7 |
| `E2E_CI_ENABLED` + `[skip e2e]` | Task 6 |
| 8 P0 tests | Task 5 |
| `data-testid` | Task 4 |
| Separate workflow | Task 6 |
| Seed in E2E only | Task 6 |
| Chromium, 1 worker | Task 3, 6 |
