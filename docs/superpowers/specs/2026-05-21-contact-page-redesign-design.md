# Contact Page Redesign + formatDate Utility

**Date:** 2026-05-21  
**Status:** Approved

## Overview

Three coordinated changes: (1) add a `formatDate()` utility to `@workspace/common`, (2) add an AI convention enforcing its use, and (3) redesign the contact detail page to fix the hierarchy, information display, button consistency, and raw timestamp issues identified in review.

---

## 1. `formatDate()` Utility

**File:** `packages/common/src/format-date.ts`  
**Export:** added to `packages/common/src/index.ts` and `package.json`

### API

```ts
export function formatDate(
  date: Date | string | number,
  opts?: { includeTime?: boolean; relative?: boolean }
): string
```

### Behavior

| Call | Output |
|------|--------|
| `formatDate(d)` | `"May 18, 2026"` |
| `formatDate(d, { includeTime: true })` | `"May 18, 2026, 10:49 PM"` |
| `formatDate(d, { relative: true })` | `"3 days ago"` / `"just now"` / `"in 2 days"` |

**Relative thresholds:**
- < 1 min → "just now"
- < 60 min → "X minutes ago" / "in X minutes"
- < 24 hrs → "X hours ago" / "in X hours"
- ≥ 24 hrs → "X days ago" / "in X days"

Relative mode does not combine with `includeTime` — if both are passed, `relative` takes precedence.

**Test file:** `packages/common/src/format-date.test.ts` — co-located per project conventions. Covers: absolute date, absolute with time, relative past (minutes, hours, days), relative future, edge cases (same minute = "just now").

---

## 2. AI Instruction

**New file:** `.ai/conventions/format-date.md`

Rule: Always use `formatDate()` from `@workspace/common` when displaying any date or timestamp in UI. Never call `.toLocaleString()`, `.toLocaleDateString()`, or `.toLocaleTimeString()` directly in component code.

**Trigger:** One line added to `.cursor/rules/shared-ai-guidance.mdc` — fires when editing files that display dates in UI.

---

## 3. Contact Page Redesign

**File:** `apps/dashboard/features/contacts/contact/ui/contact-detail-page-content.tsx`

### 3a. Hero Header (new)

Replace the floating `<Badge variant="outline">{contact.kind}</Badge>` and empty space at the top of `<PageBody>` with a contact hero card:

- **Avatar circle**: 56px, uses first letter(s) of `contact.displayName`, neutral background
- **Name**: `text-2xl font-semibold` heading
- **Badges row**: entity kind badge + stage badge (if present), inline
- **Edit button**: stays in `PageHeaderInOrg` actions (no change to header)

Layout: horizontal flex — avatar on left, name + badges stacked on right.

### 3b. Contact Info (improved)

Replace the flat `grid grid-cols-2 gap-4 text-sm` block with icon + label rows:

- Each row: icon (from `@workspace/ui/components/icon-for`) + label + value
- Email → `mailto:` anchor, opens email client
- Phone → `tel:` anchor
- Website → external `<a>` link with `target="_blank"` and `rel="noopener noreferrer"`
- Parent contact → router link (existing behavior, keep)
- If no email, no phone, no website, no parent: render a subtle "No contact info" empty state instead of nothing

### 3c. Tasks (improved)

- Task cards: increase padding to `p-3`, add `gap-3` between status + title
- Due date: `formatDate(task.dueAt)` — absolute date format
- **"Edit" button**: `variant="outline"` (unchanged)
- **"Remove" button**: `variant="destructive"` — visually distinct from Edit
- Empty state: existing "No open tasks." text is fine

### 3d. Notes & Activity (improved)

- Timestamp: `formatDate(i.happenedAt, { relative: true })` — replaces raw `.toLocaleString()`
- Note type badge: keep `<Badge variant="outline">{i.type}</Badge>` — already reasonable
- **"Edit" button**: `variant="outline"` (unchanged)
- **"Remove" button**: `variant="destructive"`

### 3e. Button Standardization

| Action | Variant |
|--------|---------|
| Add Task | `default` (black filled) — already correct |
| Add Note | `default` — change from current gray |
| Edit (task/note) | `outline` — already correct |
| Remove (task/note) | `destructive` — change from `outline` |

---

## Critical Tests

- `packages/common/src/format-date.test.ts` — unit tests for all `formatDate()` modes and edge cases. Must pass before merging.
- No new E2E tests required — UI changes are cosmetic/structural, covered by TypeScript type-checking and visual review.

---

## Out of Scope

- Timeline/activity feed (more than notes)
- Two-column layout
- Bulk task management
- Contact merge or deduplication
