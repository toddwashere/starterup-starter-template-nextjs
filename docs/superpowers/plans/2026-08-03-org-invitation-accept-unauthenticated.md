# Org Invitation Accept (Unauthenticated) Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unauthenticated users who open an org invitation link see a sign-in (or sign-up) prompt with a return path, not a false “Invalid Invitation” error caused by calling Better Auth `get-invitation` without a session.

**Architecture:** Dashboard-only UI fix in the accept-invitation client page. Better Auth’s `GET /organization/get-invitation` **requires a session** and additionally checks that `session.user.email` matches the invitation recipient. Do **not** change Better Auth server config or invent a public invitation-preview API. Gate the invitation fetch on an authenticated session; when there is no session, render auth CTAs and preserve `redirectTo` back to `/accept-invitation/:id`.

**Tech Stack:** Next.js (dashboard), Better Auth organization client, React Query, Vitest + Testing Library.

**Design spec:** none (bugfix; behavior already implied by the accept-invitation page’s “Sign In Required” branch).

**Portability:** This plan is self-contained and can be executed in this repo or an upstream checkout with the same accept-invitation page. Paths below are relative to the monorepo root.

---

## Root Cause (confirmed)

Observed in production (`dashboard`):

1. Invite email links to `/accept-invitation/authinv_…`.
2. Page is public (`apps/dashboard/proxy.ts` allows `/accept-invitation`).
3. `AcceptInvitationPageContent` always calls `authClient.organization.getInvitation({ query: { id } })`.
4. Better Auth `get-invitation` (organization plugin) does:

   ```ts
   const session = await getSessionFromCtx(ctx);
   if (!session) throw APIError.fromStatus("UNAUTHORIZED", { message: "Not authenticated" });
   ```

5. Unauthenticated (e.g. Incognito) → **401**.
6. `authClient` uses `fetchOptions: { throw: true }` (`packages/auth/src/auth-client.ts`), so the React Query `queryFn` throws.
7. UI treats missing `invitation` data as **Invalid Invitation**, and never reaches the existing “Sign In Required” branch (which incorrectly assumes invitation details are available before auth).

Secondary bug: the sign-in link uses `callbackUrl=…` while the dashboard proxy and post-auth redirect helpers prefer / also accept `redirectTo`. Use `redirectTo` for consistency with `apps/dashboard/proxy.ts` and `getPostAuthRedirectPath`.

Out of scope for this plan (do not expand unless separately requested):

- Public, unauthenticated invitation preview API.
- Changing Better Auth invitation email verification / opaque ID settings.
- Email-mismatch UX after sign-in (FORBIDDEN when signed-in email ≠ invite email) — optional follow-up only if touched while fixing error handling.

---

## Intended UX (after fix)

| State | UI |
|-------|----|
| Session loading | Skeleton (unchanged) |
| No session | “Sign In Required” card: copy that they were invited; primary **Sign in**, secondary **Create account**; both preserve `redirectTo=/accept-invitation/:id` |
| Session + invitation pending for this email | Accept / Decline card (unchanged) |
| Session + invitation missing / expired / not pending | “Invalid Invitation” (unchanged meaning) |
| Session + invitation for a different email | Prefer a distinct message (“signed in as X; invite was sent to Y”) if easy; otherwise keep Invalid Invitation — see Task 2 |

Do **not** call `getInvitation` until `session?.user` is present.

---

## File Structure

| File | Change |
|------|--------|
| Modify: `apps/dashboard/features/organization/ui/accept-invitation-page-content.tsx` | Gate fetch on session; fix auth CTAs + `redirectTo`; improve error handling |
| Create: `apps/dashboard/features/organization/ui/accept-invitation-page-content.test.tsx` | Critical unit tests for unauthenticated / authenticated / invalid paths |

No auth package, proxy, or email template changes required for the root-cause fix.

---

## Critical Tests

- `apps/dashboard/features/organization/ui/accept-invitation-page-content.test.tsx`:
  - **Unauthenticated:** does **not** call `organization.getInvitation`; shows sign-in CTA; link/href includes `redirectTo=/accept-invitation/<id>` (URL-encoded as appropriate).
  - **Unauthenticated:** offers a create-account path that also preserves the same `redirectTo`.
  - **Authenticated + valid invitation:** calls `getInvitation` once with the invitation id; renders org name / Accept.
  - **Authenticated + failed/missing invitation:** shows “Invalid Invitation” (and does **not** show Sign In Required).
  - **Session still pending:** shows loading skeleton; does not call `getInvitation` yet.

Avoid low-value “renders without crashing” only tests. Mock `authClient.useSession`, `authClient.organization.getInvitation` / `acceptInvitation` / `rejectInvitation`, and Next `useRouter`.

---

### Task 1: Failing tests for accept-invitation auth gate

**Files:**

- Create: `apps/dashboard/features/organization/ui/accept-invitation-page-content.test.tsx`

- [ ] **Step 1: Write failing tests** covering the Critical Tests bullets above.

Sketch (adapt to dashboard Vitest / Testing Library patterns already used in nearby `*.test.tsx` files):

```tsx
// apps/dashboard/features/organization/ui/accept-invitation-page-content.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AcceptInvitationPageContent } from "./accept-invitation-page-content";

const mockGetInvitation = vi.fn();
const mockUseSession = vi.fn();
const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@workspace/auth/client", () => ({
  authClient: {
    useSession: () => mockUseSession(),
    organization: {
      getInvitation: (...args: unknown[]) => mockGetInvitation(...args),
      acceptInvitation: vi.fn(),
      rejectInvitation: vi.fn(),
    },
  },
}));

function renderPage(invitationId = "authinv_test") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AcceptInvitationPageContent invitationId={invitationId} />
    </QueryClientProvider>,
  );
}

describe("AcceptInvitationPageContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prompts sign-in without calling getInvitation when unauthenticated", async () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false });
    renderPage("authinv_abc");
    expect(
      await screen.findByRole("heading", { name: /sign in required/i }),
    ).toBeInTheDocument();
    expect(mockGetInvitation).not.toHaveBeenCalled();
    const signIn = screen.getByRole("link", { name: /sign in/i });
    // prefer <a href> or button that navigates — assert redirectTo query
    expect(signIn.getAttribute("href") ?? "").toMatch(
      /redirectTo=.*accept-invitation%2Fauthinv_abc/,
    );
  });

  it("fetches invitation only after session is present", async () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: "user_1", email: "invitee@example.com" } },
      isPending: false,
    });
    mockGetInvitation.mockResolvedValue({
      id: "authinv_abc",
      organizationName: "Acme",
      organizationSlug: "acme",
      role: "member",
      inviterEmail: "owner@example.com",
    });
    renderPage("authinv_abc");
    await waitFor(() => expect(mockGetInvitation).toHaveBeenCalled());
    expect(
      await screen.findByRole("heading", { name: /organization invitation/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });

  it("shows invalid invitation when authenticated fetch fails", async () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: "user_1", email: "invitee@example.com" } },
      isPending: false,
    });
    mockGetInvitation.mockRejectedValue(new Error("Invitation not found!"));
    renderPage("authinv_abc");
    expect(
      await screen.findByRole("heading", { name: /invalid invitation/i }),
    ).toBeInTheDocument();
  });
});
```

If the dashboard suite uses a shared render helper / MSW, prefer that over inventing a new pattern — keep assertions identical.

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter dashboard test features/organization/ui/accept-invitation-page-content.test.tsx
```

Expected: FAIL — unauthenticated path currently calls `getInvitation` and/or shows Invalid Invitation; `callbackUrl` instead of `redirectTo`.

- [ ] **Step 3: Commit tests only (optional but preferred for TDD)**

```bash
git add apps/dashboard/features/organization/ui/accept-invitation-page-content.test.tsx
git commit -m "$(cat <<'EOF'
test(dashboard): cover unauthenticated org invitation accept gate

EOF
)"
```

---

### Task 2: Fix accept-invitation page gating and redirect params

**Files:**

- Modify: `apps/dashboard/features/organization/ui/accept-invitation-page-content.tsx`

- [ ] **Step 1: Gate the invitation query on session**

Requirements:

1. `authClient.useSession()` first.
2. While `sessionLoading` (`isPending`), show skeleton; **do not** enable the invitation query.
3. If `!session?.user` after session settles → render **Sign In Required** (org name optional/generic: “an organization” is fine without a public preview API). Include:
   - Primary: Sign in → `${getPathForSignIn()}?redirectTo=/accept-invitation/${invitationId}`
   - Secondary: Create account → `${getPathForSignUp()}?redirectTo=/accept-invitation/${invitationId}` (import `getPathForSignUp` from `@workspace/routes`)
4. If session exists → `useQuery` with `enabled: !!session?.user`, `retry: false`, `queryKey: ["invitation", invitationId]`, `queryFn` calling `getInvitation`.
5. On query error or empty data → **Invalid Invitation**.
6. On success → existing Accept / Decline UI.

Remove the impossible branch that required `invitation` before showing Sign In Required.

Suggested shape:

```tsx
const { data: session, isPending: sessionLoading } = authClient.useSession();
const hasUser = !!session?.user;

const {
  data: invitation,
  isLoading: invitationLoading,
  isError: invitationError,
} = useQuery({
  queryKey: ["invitation", invitationId],
  queryFn: async () =>
    authClient.organization.getInvitation({
      query: { id: invitationId },
    }),
  enabled: hasUser,
  retry: false,
});

if (sessionLoading || (hasUser && invitationLoading)) {
  // skeleton
}

if (!hasUser) {
  // Sign In Required + Sign in / Create account with redirectTo
}

if (invitationError || !invitation) {
  // Invalid Invitation
}

// Accept / Decline using invitation fields
```

Use `redirectTo` (not `callbackUrl`). Relative path only: `/accept-invitation/${invitationId}`.

Optional improvement (same task if cheap): if the thrown error message/code indicates recipient mismatch, show “This invitation was sent to a different email than the account you’re signed in with.” Otherwise keep Invalid Invitation.

- [ ] **Step 2: Run unit tests — expect PASS**

```bash
pnpm --filter dashboard test features/organization/ui/accept-invitation-page-content.test.tsx
```

- [ ] **Step 3: Manual verification checklist (local or deployed)**

1. Sign out / Incognito → open `/accept-invitation/<valid-id>` → **Sign In Required**, Network tab has **no** `get-invitation` 401 loop.
2. Sign in with the **invitee** email (or create account then verify if required) → land back on accept page via `redirectTo` → invitation details + Accept works.
3. Accept → member of org; redirect to org slug.
4. Open a garbage id while signed in → Invalid Invitation.
5. Confirm invite email still links to `/accept-invitation/<id>` (no email change needed).

- [ ] **Step 4: Commit**

```bash
git add \
  apps/dashboard/features/organization/ui/accept-invitation-page-content.tsx \
  apps/dashboard/features/organization/ui/accept-invitation-page-content.test.tsx
git commit -m "$(cat <<'EOF'
fix(dashboard): gate org invitation fetch on authenticated session

Unauthenticated invite links were calling Better Auth get-invitation,
which returns 401 and was mis-rendered as an expired invitation.
EOF
)"
```

---

## Verification (both this checkout and upstream)

After implementing on any clone:

```bash
pnpm --filter dashboard test features/organization/ui/accept-invitation-page-content.test.tsx
pnpm --filter dashboard type-check
```

Deployed smoke (prod/staging): open a fresh invite in a logged-out browser → Sign In Required → sign in as invitee → Accept succeeds. Confirm Network: `get-invitation` only after session cookies exist, and returns 200 for a valid pending invite to that email.

---

## Non-goals / do not

- Do not add a public `get-invitation` bypass on the auth server.
- Do not change invitation id generation or email templates for this bug.
- Do not use `git push --force`, `git reset --hard`, or read `.env` secret files.
- Do not broaden into member-role or invite-create permission work unless a separate failure is proven after this UI gate lands.
