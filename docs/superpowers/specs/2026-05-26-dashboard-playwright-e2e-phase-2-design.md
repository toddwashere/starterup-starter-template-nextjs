# Dashboard Playwright E2E — Phase 2 Design

**Date:** 2026-05-26  
**Status:** Approved

**Depends on:** [Phase 1 E2E](./2026-05-25-dashboard-playwright-e2e-design.md) implemented (`e2e/`, `run-e2e.mts`, opt-in `e2e.yml`).

## Overview

Phase 2 expands dashboard E2E with **tagged critical vs untagged extended** tests, a **route manifest** (single source of truth) with Vitest sync checks and generated Playwright route smokes, **additive `db:seed:e2e`** fixtures, a **nightly full suite**, and CI that runs **only `@critical`** on PRs. Goals: maintainability (no hand-maintained URL lists), fewer drift bugs, minimal extra complexity.

---

## Decisions

| Topic | Decision |
|-------|----------|
| **Critical filter** | `pnpm test:e2e` → Playwright `--grep @critical` |
| **Full suite** | `pnpm test:e2e:all` → all specs (critical + **untagged**); no `@extended` tag |
| **Untagged meaning** | Optional / contacts feature — runs in full suite + nightly only |
| **PR CI (`e2e.yml`)** | `pnpm test:e2e` (critical) when `E2E_CI_ENABLED=true` |
| **Nightly** | New workflow; `pnpm test:e2e:all`; same Postgres + `db:seed` + `db:seed:e2e` |
| **Route coverage** | Manifest in `packages/routes` + Vitest sync + generated Playwright loops |
| **Contacts** | `feature: 'contacts'` on manifest → untagged Playwright only; flow tests untagged |
| **Cross-org** | `user@example.com` visits `/other-org/...` → **redirect away** (not a member) |
| **Create org** | `e2e-empty@example.com` (no orgs) in **e2e seed only** |
| **Demo seed** | `packages/database/prisma/seed.ts` **unchanged** in spirit; e2e fixtures additive |
| **E2E seed** | `db:seed:e2e` after `db:seed` in E2E/nightly CI |
| **Branch protection** | Document manual enable after bake; not automated in repo |
| **v1 contact tests** | Retag/remove `@critical`; move to untagged `contacts.spec.ts` |

---

## Scope

### In scope

- `packages/routes/src/dashboard-route-manifest.ts` (+ exports, `getPathFor*` gaps filled)
- Vitest `apps/dashboard/e2e/route-manifest.test.ts` (nav ↔ filesystem ↔ manifest)
- Playwright: retag/split specs, new critical flows, `route-smoke.generated.spec.ts` (or inline loop), `contacts.spec.ts` (untagged)
- `packages/database/prisma/seed-e2e.ts` + `db:seed:e2e` script
- `run-e2e.mts`: default passes `--grep @critical`; `test:e2e:all` passes no grep
- `.github/workflows/e2e-nightly.yml` (scheduled full suite)
- Update `e2e.yml` to `db:seed && db:seed:e2e`
- README: tagging rules, seeds, nightly, manifest checklist for new pages
- Link from phase 1 spec follow-ups

### Out of scope

- Stripe checkout / portal E2E
- AI message streaming / MCP live test
- Invitation accept, password-reset email E2E
- Link crawler (optional phase 3 note only)
- Required `e2e` branch protection automation
- GHCR Postgres / `.next` artifact reuse (2B tasks in plan, optional)

---

## Tagging model

| Tag | Runs in `test:e2e` | Runs in `test:e2e:all` / nightly |
|-----|-------------------|-----------------------------------|
| `@critical` | Yes | Yes |
| *(untagged)* | No | Yes |

**Convention for contributors:** Core template journeys → `@critical`. Contacts and optional features → leave **untagged**. PR checklist: “Does this need `@critical`?”

**Risk:** Forgotten tag → only nightly fails. Mitigate via README + manifest for route smokes (generated).

---

## Route manifest (source of truth)

**File:** `packages/routes/src/dashboard-route-manifest.ts`

Each entry:

```typescript
type DashboardRouteEntry = {
  id: string; // stable id, used for test titles and data-testid
  path: (ctx: RouteContext) => string;
  auth: "public" | "session" | "org-member";
  critical: boolean; // true → @critical Playwright + must be in nav or documented orphan
  feature?: "contacts"; // omits from critical Playwright loop
  dynamicParams?: Record<string, string>; // e2e seed keys, e.g. contactId
  excludeFromNavSync?: boolean; // e.g. accept-invitation, dev
};
```

`RouteContext`: `{ orgSlug: string; invitationId?: string; contactId?: string }`.

### Initial manifest (v2)

**Public / session (`critical: true` unless noted)**

| id | Path pattern | auth | critical | feature |
|----|--------------|------|----------|---------|
| `home` | `/` | session | yes | |
| `sign-in` | `/sign-in` | public | yes | |
| `sign-up` | `/sign-up` | public | yes | |
| `create-org` | `/create-org` | session | yes | |
| `account` | `/account` | session | yes | |
| `org-home` | `/{slug}` | org-member | yes | |
| `org-ai` | `/{slug}/ai` | org-member | yes | |
| `org-settings-general` | `/{slug}/settings/general` | org-member | yes | |
| `org-settings-members` | `/{slug}/settings/members` | org-member | yes | |
| `org-settings-billing` | `/{slug}/settings/billing` | org-member | yes | |
| `org-settings-api-keys` | `/{slug}/settings/api-keys` | org-member | yes | |
| `org-settings-mcp` | `/{slug}/settings/mcp` | org-member | yes | |
| `org-settings-mcp-test` | `/{slug}/settings/api-keys/mcp-test` | org-member | yes | |
| `org-contacts` | `/{slug}/contacts` | org-member | no | contacts |
| `org-contacts-tasks` | `/{slug}/contacts/tasks` | org-member | no | contacts |
| `org-contacts-settings` | `/{slug}/contacts/settings` | org-member | no | contacts |
| `org-contact-detail` | `/{slug}/contacts/{contactId}` | org-member | no | contacts |

**Excluded from nav sync (`excludeFromNavSync: true`):** `accept-invitation`, `forgot-password`, `reset-password`, `verify-email`, `consent`, `dev-ui`.

**Nav drift:** Settings nav includes `/settings/security` today with **no** `page.tsx` — phase 2 Vitest sync test should **fail** until page removed from nav or page added (fix as part of implementation).

### `getPathFor*` alignment

Add missing helpers (used by manifest and app):

- `getPathForOrgAi(orgSlug)`
- `getPathForOrgContacts(orgSlug)` (+ tasks, settings, contact detail)
- `getPathForOrgBilling(orgSlug)`
- `getPathForOrgApiKeys(orgSlug)`

Manifest `path` functions call these helpers — no duplicate string literals.

### Vitest sync (`route-manifest.test.ts`)

1. Every manifest entry with `critical: true` and no `excludeFromNavSync` resolves to an existing `app/**/page.tsx` (parameterize `[org-slug]` → `acme-inc`, etc.).
2. Every `href` in `orgNavConfig` and `orgSettingsNavConfig` (excluding `/settings/security` until fixed) matches a manifest entry or documented exclusion.
3. Optional: every `getPathFor*` export used in app matches a manifest id.

Runs in `pnpm test` (fast, no browser).

### Playwright route smokes (generated)

**File:** `apps/dashboard/e2e/route-smoke.spec.ts`

- Loop `dashboardRoutes.filter(r => r.critical)` → `test(\`${id} loads @critical\`, ...)`.
- Separate loop or file `contacts-route-smoke.spec.ts` **untagged**: `feature === 'contacts'`.
- Assertions per route:
  - HTTP/navigation: not `/sign-in` (unless `auth: public`)
  - No generic 500 page (use `page.getByRole('heading')` or `data-testid="page-${id}"` when present)
- Use `storageState` for org-member routes; fresh context for public.

**Page roots:** Add optional `data-testid={`page-${id}`}` on `*-page-content` roots when touching pages (see add-new-page skill update in plan).

---

## E2E seed (`db:seed:e2e`)

**File:** `packages/database/prisma/seed-e2e.ts`  
**Script:** `pnpm --filter @workspace/database db:seed:e2e` → `tsx prisma/seed-e2e.ts`

**CI order:** `migrate deploy` → `db:seed` → `db:seed:e2e`.

**Additive fixtures (do not remove demo seed):**

| Fixture | Purpose |
|---------|---------|
| `other-org` / slug `other-org` | Cross-org redirect test; `user@` not a member |
| `e2e-empty@example.com` / `password123` | Create-org flow; zero organizations |
| `e2e-contact-1` | Stable contact id in `acme-inc` for detail route (create if missing) |

Document credentials in README and `seed-e2e.ts` header comment.

---

## Playwright suites (phase 2)

### `@critical` (PR + `pnpm test:e2e`)

**From v1 (adjust files/tags):**

| ID | Test | File |
|----|------|------|
| A1 | Unauthenticated protected → sign-in + `redirectTo` | `auth.spec.ts` |
| A2 | Sign-in → org picker | `auth.spec.ts` |
| B1 | Enter `acme-inc` | `org.spec.ts` |
| C1 | Sidebar: Dashboard, AI, Settings/Members (not contacts CRUD) | `org.spec.ts` |
| E4 | API key create listed | `settings.spec.ts` |

**New critical:**

| ID | Test |
|----|------|
| 2A-1 | Sign out → protected redirects to sign-in |
| 2A-2 | `redirectTo=/create-org` after login |
| 2A-4 | `user@` → `/other-org` → redirect away |
| 2A-5 | `e2e-empty@` create org → new slug URL |
| 2A-6 | Billing page renders (no Stripe navigation) |
| 2A-7 | Members invite: invalid email shows validation (no email sent) |
| 2A-8 | Admin `storageState`: access owner-only UI (e.g. billing manage or invite role) |
| RM | Manifest critical route smokes (generated loop) |

**Auth setup projects:**

- `e2e/.auth/user.json` — `user@example.com`
- `e2e/.auth/admin.json` — `admin@example.com`
- Setup for empty user optional inline in create-org spec (sign in once per worker).

### Untagged (extended — `test:e2e:all` + nightly only)

| ID | Test | File |
|----|------|------|
| D1 | Contacts list loads | `contacts.spec.ts` |
| D2 | Create contact | `contacts.spec.ts` |
| D3 | Contact detail | `contacts.spec.ts` |
| 2A-3 | Edit contact on detail | `contacts.spec.ts` |
| RM-C | Manifest contacts route smokes | `contacts-route-smoke.spec.ts` |

---

## Commands & `run-e2e.mts`

| Script | Behavior |
|--------|----------|
| `test:e2e` | `run-e2e.mts` → `playwright test --grep @critical` |
| `test:e2e:all` | `run-e2e.mts all` → **no** `--grep` (runs critical + untagged) |

Do not use `--grep-invert @critical` — untagged tests would still match incorrectly. Full suite = no grep filter.

```json
"test:e2e": "tsx e2e/run-e2e.mts",
"test:e2e:all": "tsx e2e/run-e2e.mts all"
```

`E2E_DISABLED=1` still skips both.

---

## Nightly workflow

**File:** `.github/workflows/e2e-nightly.yml`

- `on: schedule` (e.g. `0 6 * * *` UTC) + `workflow_dispatch`
- Same Postgres/migrate/seed steps as `e2e.yml`
- `pnpm test:e2e:all`
- Upload Playwright report on failure
- Does **not** need `E2E_CI_ENABLED` (always runs when workflow exists; can use same variable if preferred)

**Recommendation:** Nightly always runs; independent of PR opt-in.

---

## CI updates (`e2e.yml`)

- After migrate: `db:seed` then `db:seed:e2e`
- Step remains `E2E_CI=1 pnpm test:e2e` (critical only)

---

## Branch protection

Document in README:

1. Implement phase 1 + phase 2; stabilize locally.
2. Set `E2E_CI_ENABLED=true`.
3. After ~1–2 weeks green on `main`, optionally require **E2E** check in branch protection.
4. Monitor **e2e-nightly** for untagged/contacts failures.

No GitHub settings automation in repo.

---

## Critical Tests

- `packages/routes/src/dashboard-route-manifest.test.ts` (or colocated `dashboard-route-manifest.test.ts` next to manifest): manifest entries have unique ids; every `critical` path is a valid template string.
- `apps/dashboard/e2e/route-manifest.test.ts`: nav hrefs ⊆ manifest; critical routes resolve to `page.tsx`; flags `/settings/security` mismatch until fixed.
- `packages/database/prisma/seed-e2e.test.ts` (optional): seed script exports ids / slugs documented in manifest `dynamicParams`.
- Playwright suites listed above (smoke + flows) — verified via `test:e2e` and `test:e2e:all` locally.

---

## Verification

- `pnpm test` — includes route-manifest Vitest
- `pnpm test:e2e` — critical only, passes with `db:seed` + `db:seed:e2e`
- `pnpm test:e2e:all` — includes untagged contacts tests
- `E2E_DISABLED=1` skips both
- Nightly workflow green on schedule (or `workflow_dispatch` trial)
- Phase 1 `ci.yml` unchanged

---

## Follow-ups (phase 3+)

- Link crawler nightly (optional)
- GHCR Postgres image + Playwright/browser cache hardening
- Reuse dashboard `.next` from `ci.yml`
- Stripe / AI / invitation E2E
- `accept-invitation` manifest entry + seed token when needed

---

## Relationship to phase 1

| Phase 1 | Phase 2 change |
|---------|----------------|
| Single `smoke.spec.ts` | Split by domain + generated route smokes |
| All tests implicit critical | Tags + untagged contacts |
| `db:seed` only in E2E CI | + `db:seed:e2e` |
| Manual route list in follow-ups | Manifest + Vitest + generated E2E |
| `test:e2e` runs all | `test:e2e` runs `@critical` only |

Do not remove Vitest unit tests from phase 1.
