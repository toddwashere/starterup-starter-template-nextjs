# Contact Page Redesign + formatDate Utility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `formatDate()` utility to `@workspace/common`, enforce its use via AI convention, add missing contact icons to the icon registry, and redesign the contact detail page with a hero header, icon-based contact info, and consistent button styling.

**Architecture:** `formatDate()` lives in `packages/common/src/format-date.ts` and is exported from the package index. The contact page (`contact-detail-page-content.tsx`) is updated in-place — no new files. Icons are added to the existing `icon-for.tsx` registry.

**Tech Stack:** TypeScript, Vitest, React 19, Next.js, Tailwind CSS, shadcn/ui, `@workspace/ui/components/icon-for`

---

## File Map

| File | Action |
|------|--------|
| `packages/common/src/format-date.ts` | **Create** — `formatDate()` implementation |
| `packages/common/src/format-date.test.ts` | **Create** — unit tests |
| `packages/common/src/index.ts` | **Modify** — add named export |
| `packages/common/package.json` | **Modify** — add `"./format-date"` export path |
| `.ai/conventions/format-date.md` | **Create** — AI convention |
| `.cursor/rules/shared-ai-guidance.mdc` | **Modify** — add trigger line |
| `packages/ui/src/components/icon-for.tsx` | **Modify** — add `IconForPhone`, `IconForWebsite` |
| `apps/dashboard/features/contacts/contact/ui/contact-detail-page-content.tsx` | **Modify** — full UI redesign |

---

## Task 1: formatDate utility

**Files:**
- Create: `packages/common/src/format-date.ts`
- Create: `packages/common/src/format-date.test.ts`

- [ ] **Step 1.1: Write the failing tests**

Create `packages/common/src/format-date.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatDate } from "./format-date";

describe("formatDate", () => {
  it("formats a Date object as absolute text", () => {
    expect(formatDate(new Date("2026-05-18T12:00:00"))).toBe("May 18, 2026");
  });

  it("formats a date string as absolute text", () => {
    expect(formatDate("2026-01-01T00:00:00")).toBe("January 1, 2026");
  });

  it("formats a timestamp number as absolute text", () => {
    expect(formatDate(new Date("2026-05-18T00:00:00").getTime())).toBe(
      "May 18, 2026",
    );
  });

  it("includes time when includeTime is true", () => {
    const result = formatDate(new Date("2026-05-18T22:49:00"), {
      includeTime: true,
    });
    expect(result).toContain("May 18, 2026");
    expect(result).toMatch(/10:49\s?PM/);
  });

  it("returns 'just now' for less than 1 minute ago", () => {
    const d = new Date(Date.now() - 30_000);
    expect(formatDate(d, { relative: true })).toBe("just now");
  });

  it("returns 'just now' for less than 1 minute in the future", () => {
    const d = new Date(Date.now() + 30_000);
    expect(formatDate(d, { relative: true })).toBe("just now");
  });

  it("returns minutes ago for past within 1 hour", () => {
    const d = new Date(Date.now() - 5 * 60_000);
    expect(formatDate(d, { relative: true })).toBe("5 minutes ago");
  });

  it("returns in X minutes for future within 1 hour", () => {
    const d = new Date(Date.now() + 15 * 60_000);
    expect(formatDate(d, { relative: true })).toBe("in 15 minutes");
  });

  it("returns hours ago for past within 24 hours", () => {
    const d = new Date(Date.now() - 3 * 3_600_000);
    expect(formatDate(d, { relative: true })).toBe("3 hours ago");
  });

  it("returns in X hours for future within 24 hours", () => {
    const d = new Date(Date.now() + 6 * 3_600_000);
    expect(formatDate(d, { relative: true })).toBe("in 6 hours");
  });

  it("returns days ago for past beyond 24 hours", () => {
    const d = new Date(Date.now() - 3 * 86_400_000);
    expect(formatDate(d, { relative: true })).toBe("3 days ago");
  });

  it("returns in X days for future beyond 24 hours", () => {
    const d = new Date(Date.now() + 2 * 86_400_000);
    expect(formatDate(d, { relative: true })).toBe("in 2 days");
  });
});
```

- [ ] **Step 1.2: Run tests to verify they fail**

```bash
cd packages/common && npx vitest run src/format-date.test.ts
```

Expected: FAIL — `Cannot find module './format-date'`

- [ ] **Step 1.3: Implement formatDate**

Create `packages/common/src/format-date.ts`:

```ts
export function formatDate(
  date: Date | string | number,
  opts?: { includeTime?: boolean; relative?: boolean },
): string {
  const d = date instanceof Date ? date : new Date(date);

  if (opts?.relative) {
    const diffMs = Date.now() - d.getTime();
    const absMinutes = Math.round(Math.abs(diffMs) / 60_000);
    const absHours = Math.round(Math.abs(diffMs) / 3_600_000);
    const absDays = Math.round(Math.abs(diffMs) / 86_400_000);
    const future = diffMs < 0;

    if (absMinutes < 1) return "just now";
    if (absMinutes < 60)
      return future ? `in ${absMinutes} minutes` : `${absMinutes} minutes ago`;
    if (absHours < 24)
      return future ? `in ${absHours} hours` : `${absHours} hours ago`;
    return future ? `in ${absDays} days` : `${absDays} days ago`;
  }

  if (opts?.includeTime) {
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(d);
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

```bash
cd packages/common && npx vitest run src/format-date.test.ts
```

Expected: all 12 tests pass.

- [ ] **Step 1.5: Export from package index and package.json**

In `packages/common/src/index.ts`, add:

```ts
export { formatDate } from "./format-date";
```

So the full file becomes:

```ts
export {
  createId,
  createIdOfLength,
  createIdTemporary,
  isTemporaryId,
} from "./create-id";
export type {
  IdPrefix,
  AuthIdPrefix,
  ContactsIdPrefix,
  BillingIdPrefix,
  McpIdPrefix,
} from "./create-id";
export { formatDate } from "./format-date";
```

In `packages/common/package.json`, add the subpath export:

```json
{
  "name": "@workspace/common",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./create-id": "./src/create-id.ts",
    "./format-date": "./src/format-date.ts",
    "./env/public-mcp": "./src/env/public-mcp.ts",
    "./mcp/http-client": "./src/mcp/http-client.ts"
  },
  "scripts": {
    "type-check": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/node": "^22",
    "@workspace/tooling": "workspace:*",
    "typescript": "^5.7",
    "vitest": "^4.1.6"
  },
  "dependencies": {
    "@paralleldrive/cuid2": "^3.3.0",
    "zod": "^3"
  }
}
```

- [ ] **Step 1.6: Run full common test suite**

```bash
cd packages/common && npx vitest run
```

Expected: all tests pass (prior 9 + new 12 = 21 total).

- [ ] **Step 1.7: Commit**

```bash
git add packages/common/src/format-date.ts packages/common/src/format-date.test.ts packages/common/src/index.ts packages/common/package.json
git commit -m "feat(common): add formatDate utility with absolute and relative modes"
```

---

## Task 2: AI convention for formatDate

**Files:**
- Create: `.ai/conventions/format-date.md`
- Modify: `.cursor/rules/shared-ai-guidance.mdc`

- [ ] **Step 2.1: Write the convention file**

Create `.ai/conventions/format-date.md`:

```markdown
# Date Formatting Convention

Always use `formatDate()` from `@workspace/common` when displaying any date or timestamp in UI code.

**Never use raw JS date methods in component code:**
- ❌ `new Date(x).toLocaleString()`
- ❌ `new Date(x).toLocaleDateString()`
- ❌ `new Date(x).toLocaleTimeString()`

**Use formatDate instead:**
- `formatDate(date)` → "May 18, 2026"
- `formatDate(date, { includeTime: true })` → "May 18, 2026, 10:49 PM"
- `formatDate(date, { relative: true })` → "3 days ago" / "just now" / "in 2 days"

**Import:**
\`\`\`ts
import { formatDate } from "@workspace/common";
// or subpath:
import { formatDate } from "@workspace/common/format-date";
\`\`\`

Apply `relative: true` for activity feeds, notes, and timestamps where recency matters. Use the default absolute format for due dates, scheduled dates, and any date the user might need to look up on a calendar.
```

- [ ] **Step 2.2: Add trigger to shared-ai-guidance.mdc**

In `.cursor/rules/shared-ai-guidance.mdc`, add this line after the existing icon rule:

```
When displaying dates or timestamps in any UI component (apps/* or packages/ui), use `formatDate()` from `@workspace/common`. Read `.ai/conventions/format-date.md` before writing date display code.
```

- [ ] **Step 2.3: Update .ai/README.md to register the new convention**

In `.ai/README.md`, add to the Conventions list:

```markdown
- [`conventions/format-date.md`](./conventions/format-date.md) - Always use `formatDate()` from `@workspace/common`; never call `.toLocaleString()` directly in UI code.
```

- [ ] **Step 2.4: Commit**

```bash
git add .ai/conventions/format-date.md .cursor/rules/shared-ai-guidance.mdc .ai/README.md
git commit -m "docs(ai): add formatDate convention and cursor trigger"
```

---

## Task 3: Add Phone and Website icons to registry

**Files:**
- Modify: `packages/ui/src/components/icon-for.tsx`

- [ ] **Step 3.1: Add Globe and Phone imports**

In `packages/ui/src/components/icon-for.tsx`, add `Globe` and `Phone` to the lucide-react import block (keep alphabetical order):

```tsx
import {
  AlertTriangle,
  BadgeCheck,
  Bell,
  Bold,
  Bot,
  Building2,
  CheckCircle2,
  ChevronRight,
  ChevronsUpDown,
  CreditCard,
  Globe,
  Italic,
  KeyRound,
  LayoutDashboard,
  Link2,
  LogOut,
  Mail,
  Monitor,
  Moon,
  MoreHorizontal,
  Phone,
  Sun,
  Plus,
  Search,
  Settings,
  Shield,
  Underline,
  Unlink,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react"
```

- [ ] **Step 3.2: Add IconForPhone and IconForWebsite components**

Append to the end of `packages/ui/src/components/icon-for.tsx` (after `IconForContacts`):

```tsx
export const IconForPhone = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Phone ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForPhone.displayName = "IconForPhone";

export const IconForWebsite = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Globe ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForWebsite.displayName = "IconForWebsite";
```

- [ ] **Step 3.3: Type-check**

```bash
cd packages/ui && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3.4: Commit**

```bash
git add packages/ui/src/components/icon-for.tsx
git commit -m "feat(ui): add IconForPhone and IconForWebsite to icon registry"
```

---

## Task 4: Redesign contact-detail-page-content.tsx

**Files:**
- Modify: `apps/dashboard/features/contacts/contact/ui/contact-detail-page-content.tsx`

- [ ] **Step 4.1: Replace the file with the redesigned version**

Replace the full contents of `apps/dashboard/features/contacts/contact/ui/contact-detail-page-content.tsx`:

```tsx
"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import NiceModal from "@ebay/nice-modal-react";
import { formatDate } from "@workspace/common";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import { StageView, TaskStatusView } from "@workspace/ui/components/entity-label-views";
import { Textarea } from "@workspace/ui/components/textarea";
import { Page, PageBody } from "@workspace/ui/components/page";
import { Separator } from "@workspace/ui/components/separator";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  IconForEmail,
  IconForPhone,
  IconForWebsite,
  IconForContacts,
} from "@workspace/ui/components/icon-for";
import { PageHeaderInOrg } from "@/common/ui/page-header-in-org";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb";
import { getContactAction } from "../data/contact-actions";
import {
  archiveContactInteractionAction,
  createContactNoteAction,
  listContactInteractionsAction,
} from "../../contact-interaction/data/contact-interaction-actions";
import {
  archiveContactTaskAction,
  listContactTasksAction,
  listContactTaskStatusesAction,
} from "../../contact-task/data/contact-task-actions";
import { EditContactButtonModal } from "./edit-contact-button-modal";
import { ContactTaskButtonModal } from "../../contact-task/ui/contact-task-button-modal";
import { EditNoteButtonModal } from "../../contact-interaction/ui/edit-note-button-modal";
import { ContactTagsEditor } from "../../contact-tag/ui/contact-tags-editor";

type Contact = Extract<
  Awaited<ReturnType<typeof getContactAction>>,
  { success: true }
>["data"];

type Interaction = Extract<
  Awaited<ReturnType<typeof listContactInteractionsAction>>,
  { success: true }
>["data"][number];

type Task = Extract<
  Awaited<ReturnType<typeof listContactTasksAction>>,
  { success: true }
>["data"][number];

type TaskStatus = Extract<
  Awaited<ReturnType<typeof listContactTaskStatusesAction>>,
  { success: true }
>["data"][number];

function ContactAvatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-lg font-semibold select-none">
      {initials}
    </div>
  );
}

export function ContactDetailPageContent({
  orgSlug,
  contactId,
}: {
  orgSlug: string;
  contactId: string;
}) {
  const router = useRouter();
  const [contact, setContact] = useState<Contact | null>(null);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskStatuses, setTaskStatuses] = useState<TaskStatus[]>([]);
  const [noteBody, setNoteBody] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const refreshInteractions = useCallback(async () => {
    const result = await listContactInteractionsAction(contactId);
    if (result.success) setInteractions(result.data);
  }, [contactId]);

  const refreshTasks = useCallback(async () => {
    const result = await listContactTasksAction(contactId);
    if (result.success) setTasks(result.data);
  }, [contactId]);

  const loadContact = useCallback(() => {
    let isCurrent = true;
    setContact(null);
    setInteractions([]);
    setTasks([]);
    setTaskStatuses([]);
    setIsLoaded(false);

    startTransition(async () => {
      const [cResult, iResult, tResult, sResult] = await Promise.all([
        getContactAction(contactId),
        listContactInteractionsAction(contactId),
        listContactTasksAction(contactId),
        listContactTaskStatusesAction(),
      ]);
      if (!isCurrent) return;
      if (cResult.success) setContact(cResult.data);
      if (iResult.success) setInteractions(iResult.data);
      if (tResult.success) setTasks(tResult.data);
      if (sResult.success) setTaskStatuses(sResult.data);
      setIsLoaded(true);
    });

    return () => {
      isCurrent = false;
    };
  }, [contactId]);

  useEffect(() => loadContact(), [loadContact]);

  async function handleAddNote() {
    if (!noteBody.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const result = await createContactNoteAction(contactId, noteBody.trim());
      if (!result.success) {
        setNoteError(result.error);
        return;
      }
      setNoteBody("");
      setNoteError(null);
      await refreshInteractions();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleEditContact() {
    if (!contact) return;
    const updated = await NiceModal.show(EditContactButtonModal, { contact });
    if (updated) loadContact();
  }

  async function handleAddTask() {
    const updated = await NiceModal.show(ContactTaskButtonModal, {
      contactId,
      statuses: taskStatuses,
    });
    if (updated) await refreshTasks();
  }

  async function handleEditTask(task: Task) {
    const updated = await NiceModal.show(ContactTaskButtonModal, {
      contactId,
      task,
      statuses: taskStatuses,
    });
    if (updated) await refreshTasks();
  }

  async function handleArchiveTask(taskId: string) {
    const result = await archiveContactTaskAction(taskId);
    if (result.success) await refreshTasks();
  }

  async function handleEditNote(interaction: Interaction) {
    const updated = await NiceModal.show(EditNoteButtonModal, {
      interactionId: interaction.id,
      body: interaction.body,
    });
    if (updated) await refreshInteractions();
  }

  async function handleArchiveNote(interactionId: string) {
    const result = await archiveContactInteractionAction(interactionId);
    if (result.success) await refreshInteractions();
  }

  if (!isLoaded && isPending) {
    return (
      <Page className="flex min-h-0 flex-1 flex-col">
        <PageHeaderInOrg
          breadcrumb={
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link href={`/${orgSlug}/contacts`}>Contacts</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <Skeleton className="h-4 w-32" />
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          }
          actions={<Skeleton className="h-9 w-28" />}
        />
        <PageBody disableScroll className="max-w-3xl space-y-6 p-6">
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </PageBody>
      </Page>
    );
  }

  if (isLoaded && !contact) {
    return (
      <Page className="flex min-h-0 flex-1 flex-col">
        <PageHeaderInOrg
          title="Contact not found"
          breadcrumb={
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link href={`/${orgSlug}/contacts`}>Contacts</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Contact not found</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          }
        />
        <PageBody disableScroll className="p-6">
          <p className="text-muted-foreground">
            This contact may have been removed or you do not have access.
          </p>
        </PageBody>
      </Page>
    );
  }

  if (!contact) return null;

  const openTasks = tasks.filter((t) => !t.completedAt);
  const hasContactInfo =
    !!contact.primaryEmail ||
    !!contact.primaryPhone ||
    !!contact.website ||
    !!contact.parent;

  return (
    <Page className="flex min-h-0 flex-1 flex-col">
      <PageHeaderInOrg
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href={`/${orgSlug}/contacts`}>Contacts</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{contact.displayName}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        actions={
          <Button variant="outline" onClick={() => void handleEditContact()}>
            Edit Contact
          </Button>
        }
      />
      <PageBody disableScroll className="max-w-3xl space-y-6 p-6">

        {/* Hero header */}
        <div className="flex items-center gap-4 rounded-lg border bg-muted/30 p-4">
          <ContactAvatar name={contact.displayName} />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold leading-tight truncate">
              {contact.displayName}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant="outline">{contact.kind}</Badge>
              {contact.stage && (
                <StageView name={contact.stage.name} color={contact.stage.color} />
              )}
            </div>
          </div>
        </div>

        {/* Tags */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Tags</h2>
          <ContactTagsEditor
            contactId={contact.id}
            assignments={contact.tags}
            onUpdated={loadContact}
          />
        </div>

        {/* Contact info */}
        <div className="space-y-2">
          {contact.primaryEmail ? (
            <div className="flex items-center gap-2 text-sm">
              <IconForEmail className="text-muted-foreground shrink-0" />
              <a
                href={`mailto:${contact.primaryEmail}`}
                className="hover:underline"
              >
                {contact.primaryEmail}
              </a>
            </div>
          ) : null}
          {contact.primaryPhone && (
            <div className="flex items-center gap-2 text-sm">
              <IconForPhone className="text-muted-foreground shrink-0" />
              <a href={`tel:${contact.primaryPhone}`} className="hover:underline">
                {contact.primaryPhone}
              </a>
            </div>
          )}
          {contact.website && (
            <div className="flex items-center gap-2 text-sm">
              <IconForWebsite className="text-muted-foreground shrink-0" />
              <a
                href={contact.website}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {contact.website}
              </a>
            </div>
          )}
          {contact.parent && (
            <div className="flex items-center gap-2 text-sm">
              <IconForContacts className="text-muted-foreground shrink-0" />
              <button
                className="hover:underline"
                onClick={() =>
                  router.push(`/${orgSlug}/contacts/${contact.parent!.id}`)
                }
              >
                {contact.parent.displayName}
              </button>
            </div>
          )}
          {!hasContactInfo && (
            <p className="text-sm text-muted-foreground">No contact info.</p>
          )}
        </div>

        {/* Related contacts */}
        {contact.children.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground mb-1">
              Related ({contact.children.length})
            </h2>
            <div className="flex flex-wrap gap-2">
              {contact.children.map(
                (child: { id: string; displayName: string; kind: string }) => (
                  <Badge
                    key={child.id}
                    variant="outline"
                    className="cursor-pointer"
                    onClick={() =>
                      router.push(`/${orgSlug}/contacts/${child.id}`)
                    }
                  >
                    {child.displayName}
                  </Badge>
                ),
              )}
            </div>
          </div>
        )}

        <Separator />

        {/* Open Tasks */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Open Tasks ({openTasks.length})</h2>
            <Button size="sm" onClick={() => void handleAddTask()}>
              Add Task
            </Button>
          </div>
          {openTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open tasks.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {openTasks.map((task) => (
                <li
                  key={task.id}
                  className="flex items-center gap-3 rounded-md border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {task.status ? (
                        <TaskStatusView
                          name={task.status.name}
                          color={task.status.color}
                          isTerminal={task.status.isTerminal}
                        />
                      ) : (
                        <Badge variant="outline">No status</Badge>
                      )}
                      <span className="font-medium">{task.title}</span>
                    </div>
                    {task.description && (
                      <p className="mt-1 text-muted-foreground">
                        {task.description}
                      </p>
                    )}
                    {task.dueAt && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Due {formatDate(task.dueAt)}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleEditTask(task)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => void handleArchiveTask(task.id)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Separator />

        {/* Notes & Activity */}
        <div>
          <h2 className="font-semibold mb-3">Notes &amp; Activity</h2>
          <div className="space-y-2 mb-4">
            <Textarea
              placeholder="Add a note…"
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              rows={3}
            />
            {noteError && (
              <p className="text-sm text-destructive">{noteError}</p>
            )}
            <Button
              size="sm"
              onClick={handleAddNote}
              disabled={!noteBody.trim() || isPending || isSubmitting}
            >
              {isSubmitting ? "Saving…" : "Add Note"}
            </Button>
          </div>

          <div className="space-y-3">
            {interactions.map((i) => (
              <div key={i.id} className="text-sm border rounded-md p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline">{i.type}</Badge>
                  <span className="text-muted-foreground text-xs">
                    {formatDate(i.happenedAt, { relative: true })}
                  </span>
                </div>
                <p>{i.body}</p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleEditNote(i)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => void handleArchiveNote(i.id)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            {interactions.length === 0 && (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            )}
          </div>
        </div>
      </PageBody>
    </Page>
  );
}
```

- [ ] **Step 4.2: Type-check the dashboard app**

```bash
cd apps/dashboard && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4.3: Commit**

```bash
git add apps/dashboard/features/contacts/contact/ui/contact-detail-page-content.tsx
git commit -m "feat(dashboard): redesign contact detail page with hero header, icon contact info, and formatDate"
```

---

## Critical Tests

- `packages/common/src/format-date.test.ts` — all 12 unit tests must pass before merging.
- TypeScript type-check passes on both `packages/common` and `apps/dashboard`.
- Visual smoke test: open a contact detail page and verify hero header renders, email/phone are clickable links, timestamps show relative format ("X days ago"), and Remove buttons are visually destructive (red).
