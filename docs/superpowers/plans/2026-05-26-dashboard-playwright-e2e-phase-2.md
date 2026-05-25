# Dashboard Playwright E2E — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add route manifest + Vitest sync, `@critical` vs untagged split, `db:seed:e2e`, expanded critical flows, contacts in extended-only specs, and nightly `test:e2e:all`.

**Architecture:** `packages/routes` owns `dashboard-route-manifest.ts`; Playwright generates route smokes from manifest; `run-e2e.mts` filters `@critical` by default; additive e2e seed after demo seed.

**Tech Stack:** Playwright tags, Vitest, Prisma seed, GitHub Actions `schedule`.

**Design spec:** [`docs/superpowers/specs/2026-05-26-dashboard-playwright-e2e-phase-2-design.md`](../specs/2026-05-26-dashboard-playwright-e2e-phase-2-design.md)

**Requires:** [Phase 1 plan](./2026-05-25-dashboard-playwright-e2e.md) completed.

---

## File Structure

| Action | Path |
|--------|------|
| Create | `packages/routes/src/dashboard-route-manifest.ts` |
| Create | `packages/routes/src/dashboard-route-manifest.test.ts` |
| Modify | `packages/routes/src/getPathFor.ts` (+ exports in `index.ts`) |
| Create | `packages/database/prisma/seed-e2e.ts` |
| Modify | `packages/database/package.json` (`db:seed:e2e`) |
| Create | `apps/dashboard/e2e/route-manifest.test.ts` |
| Create | `apps/dashboard/e2e/route-smoke.spec.ts` |
| Create | `apps/dashboard/e2e/contacts-route-smoke.spec.ts` |
| Create | `apps/dashboard/e2e/auth.spec.ts` (from smoke split) |
| Create | `apps/dashboard/e2e/org.spec.ts` |
| Create | `apps/dashboard/e2e/settings.spec.ts` |
| Create | `apps/dashboard/e2e/contacts.spec.ts` (untagged) |
| Modify | `apps/dashboard/e2e/run-e2e.mts` |
| Modify | `apps/dashboard/e2e/playwright.config.ts` (admin project) |
| Modify | `apps/dashboard/e2e/auth.setup.ts` (+ `auth.admin.setup.ts`) |
| Modify | `apps/dashboard/package.json` |
| Create | `.github/workflows/e2e-nightly.yml` |
| Modify | `.github/workflows/e2e.yml` |
| Modify | `README.md` |
| Modify | `docs/superpowers/specs/2026-05-25-dashboard-playwright-e2e-design.md` (follow-ups link) |
| Fix | `nav-items-org-settings.ts` OR add security page (manifest sync) |

---

## Critical Tests

- `packages/routes/src/dashboard-route-manifest.test.ts`: unique route ids; `critical` routes produce paths containing `{slug}` substitution without empty segments.
- `apps/dashboard/e2e/route-manifest.test.ts`: org nav + settings nav hrefs match manifest; each `critical` route maps to existing `page.tsx`; documents `other-org` not in user nav.
- `apps/dashboard/e2e/auth.spec.ts` + `org.spec.ts` + `settings.spec.ts`: tagged `@critical` per phase 2 spec table.
- `apps/dashboard/e2e/contacts.spec.ts` + `contacts-route-smoke.spec.ts`: **no** `@critical` tag.
- `apps/dashboard/e2e/route-smoke.spec.ts`: generated critical manifest loop passes for `acme-inc`.

---

## Task 1: Route manifest and getPathFor helpers

**Files:**

- Create: `packages/routes/src/dashboard-route-manifest.ts`
- Modify: `packages/routes/src/getPathFor.ts`, `packages/routes/src/index.ts`
- Create: `packages/routes/src/dashboard-route-manifest.test.ts`

- [ ] **Step 1:** Define `DashboardRouteEntry` type and `dashboardRoutes` array per phase 2 spec table (include `feature: 'contacts'` entries).

- [ ] **Step 2:** Add `getPathForOrgAi`, `getPathForOrgContacts`, `getPathForOrgContactsTasks`, `getPathForOrgContactsSettings`, `getPathForOrgContactDetail`, `getPathForOrgBilling`, `getPathForOrgApiKeys` — manifest uses these exclusively.

- [ ] **Step 3:** Export `dashboardRoutes`, `getCriticalDashboardRoutes()`, `getContactsDashboardRoutes()` from `packages/routes/src/index.ts`.

- [ ] **Step 4:** Vitest: unique ids; snapshot or assert path builders with `orgSlug: 'acme-inc'`.

- [ ] **Step 5:** Run `pnpm --filter @workspace/routes test`.

---

## Task 2: Nav / filesystem sync test

**Files:**

- Create: `apps/dashboard/e2e/route-manifest.test.ts`
- Modify: `apps/dashboard/app/(organization)/[org-slug]/settings/nav-items-org-settings.ts` **or** add missing security page

- [ ] **Step 1:** Implement href collector from `orgNavConfig` + `orgSettingsNavConfig` (strip `basePath`, normalize to manifest keys).

- [ ] **Step 2:** Assert each href matches a manifest entry (after prefixing `/{orgSlug}`).

- [ ] **Step 3:** Resolve manifest `critical` paths to glob under `apps/dashboard/app` (map `[org-slug]` → literal `acme-inc` for filesystem check only).

- [ ] **Step 4:** Fix `/settings/security` drift: **remove nav item** until page exists (preferred YAGNI) OR add stub page — pick one, document in PR.

- [ ] **Step 5:** `pnpm --filter @apps/dashboard test`.

---

## Task 3: `db:seed:e2e`

**Files:**

- Create: `packages/database/prisma/seed-e2e.ts`
- Modify: `packages/database/package.json`

- [ ] **Step 1:** Implement upserts: `other-org`, `e2e-empty@example.com` (+ credential account), contact `e2e-contact-1` under `acme-inc` if not exists.

- [ ] **Step 2:** Add script `"db:seed:e2e": "dotenv -e ../../.env -- tsx prisma/seed-e2e.ts"`.

- [ ] **Step 3:** Document in file header: run after `db:seed`; passwords `password123`.

- [ ] **Step 4:** Manual: `db:seed && db:seed:e2e` — verify fixtures in DB.

---

## Task 4: `run-e2e.mts` and package scripts

**Files:**

- Modify: `apps/dashboard/e2e/run-e2e.mts`
- Modify: `apps/dashboard/package.json`
- Modify: root `package.json`

- [ ] **Step 1:** If argv contains `all` → spawn Playwright **without** `--grep`.

- [ ] **Step 2:** Default → append `--grep @critical`.

- [ ] **Step 3:** Add `"test:e2e:all": "tsx e2e/run-e2e.mts all"`.

- [ ] **Step 4:** Root `"test:e2e:all": "pnpm --filter @apps/dashboard test:e2e:all"`.

- [ ] **Step 5:** Verify `E2E_DISABLED=1` still exits 0 for both commands.

---

## Task 5: Playwright auth setups

**Files:**

- Create: `apps/dashboard/e2e/auth.admin.setup.ts`
- Modify: `apps/dashboard/e2e/playwright.config.ts`

- [ ] **Step 1:** `auth.setup.ts` — `user@example.com` → `.auth/user.json` (existing).

- [ ] **Step 2:** `auth.admin.setup.ts` — `admin@example.com` → `.auth/admin.json`.

- [ ] **Step 3:** Projects: `setup`, `setup-admin`, `chromium` (user), `chromium-admin` (admin storageState) — tag admin-only tests with project dependency.

- [ ] **Step 4:** Document in spec which tests use admin project.

---

## Task 6: Split and tag v1 specs + new critical flows

**Files:**

- Create: `auth.spec.ts`, `org.spec.ts`, `settings.spec.ts`
- Delete or empty: `smoke.spec.ts` after migration

- [ ] **Step 1:** Move v1 tests into domain files; add `@critical` to each.

- [ ] **Step 2:** Implement 2A-1 sign out (clear session / sign out button → visit `/` or protected → sign-in).

- [ ] **Step 3:** Implement 2A-2 `redirectTo` (visit `/create-org` logged out → sign in → lands create-org).

- [ ] **Step 4:** Implement 2A-4 cross-org redirect for `user@` + `/other-org/contacts`.

- [ ] **Step 5:** Implement 2A-5 `e2e-empty@` create org (unique slug `e2e-org-${Date.now()}`).

- [ ] **Step 6:** Implement 2A-6 billing render (`getByRole` / plan section visible).

- [ ] **Step 7:** Implement 2A-7 members invite validation (empty/invalid email → error).

- [ ] **Step 8:** Implement 2A-8 admin-only check on `chromium-admin` project.

- [ ] **Step 9:** C1 sidebar — navigate AI + Settings/Members only (not contacts list assertion).

- [ ] **Step 10:** `pnpm test:e2e` passes.

---

## Task 7: Route smoke generation

**Files:**

- Create: `apps/dashboard/e2e/route-smoke.spec.ts`
- Create: `apps/dashboard/e2e/contacts-route-smoke.spec.ts`
- Modify: page content files (optional `data-testid={`page-${id}`}`)

- [ ] **Step 1:** Import `getCriticalDashboardRoutes` from `@workspace/routes`; loop `test(\`${id} loads @critical\`, ...)`.

- [ ] **Step 2:** Use `storageState` + `orgSlug: 'acme-inc'` from env or constant; substitute `dynamicParams` from seed doc (`contactId` only in contacts file).

- [ ] **Step 3:** `contacts-route-smoke.spec.ts` — loop `getContactsDashboardRoutes()`, **no** `@critical` tag.

- [ ] **Step 4:** Add `data-testid="page-org-ai"` (etc.) to key page contents when tests flake on headings.

- [ ] **Step 5:** `pnpm test:e2e` and `pnpm test:e2e:all` — critical vs contacts split verified.

---

## Task 8: Contacts extended specs (untagged)

**Files:**

- Create: `apps/dashboard/e2e/contacts.spec.ts`

- [ ] **Step 1:** Move D1, D2, D3 from v1; implement 2A-3 edit contact — **no** `@critical` in title/tag.

- [ ] **Step 2:** Confirm `pnpm test:e2e` does **not** run these; `pnpm test:e2e:all` does.

---

## Task 9: CI — e2e.yml + nightly

**Files:**

- Modify: `.github/workflows/e2e.yml`
- Create: `.github/workflows/e2e-nightly.yml`

- [ ] **Step 1:** `e2e.yml` — after migrate add `pnpm --filter @workspace/database db:seed` and `db:seed:e2e`.

- [ ] **Step 2:** `e2e-nightly.yml` — `schedule: 0 6 * * *`, `workflow_dispatch`, same infra, run `pnpm test:e2e:all`, upload report on failure.

- [ ] **Step 3:** Nightly does not require `E2E_CI_ENABLED` (always on for forks: consider `if: github.repository == 'org/repo'` or document).

- [ ] **Step 4:** Trial `workflow_dispatch` on branch.

---

## Task 10: Documentation and phase 1 link

**Files:**

- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-05-25-dashboard-playwright-e2e-design.md`

- [ ] **Step 1:** README — E2E section: `db:seed` + `db:seed:e2e`, `test:e2e` vs `test:e2e:all`, `@critical` vs untagged, nightly workflow, branch protection steps, new page checklist (manifest + getPathFor + testid).

- [ ] **Step 2:** Phase 1 spec follow-ups — replace P1 bullet with link to phase 2 spec.

- [ ] **Step 3:** Optional: `.ai/skills/add-new-page/SKILL.md` one paragraph on manifest (separate PR if scope tight).

---

## Task 11: Final verification

- [ ] `pnpm test` — route manifest tests pass.
- [ ] `pnpm test:e2e` — critical only, 0 failures.
- [ ] `pnpm test:e2e:all` — includes contacts.
- [ ] `E2E_DISABLED=1` on both scripts.
- [ ] `ci.yml` still green; `e2e.yml` with variable enabled uses both seeds.
- [ ] Nightly `workflow_dispatch` green.

---

## Spec coverage self-check

| Design item | Task |
|-------------|------|
| Route manifest | 1, 7 |
| Vitest nav sync | 2 |
| `@critical` / untagged | 4, 6, 8 |
| `db:seed:e2e` | 3, 9 |
| Nightly full suite | 9 |
| Cross-org redirect | 6 |
| create-org empty user | 3, 6 |
| Contacts extended | 7, 8 |
| Branch protection docs | 10 |
| run-e2e `all` argv | 4 |
