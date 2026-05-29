# Dashboard Command Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global `Cmd+K` / `Ctrl+K` command palette to the dashboard that works across all routes and supports navigation, theme switching, sign-out, and organization switching.

**Architecture:** A `GlobalCommandMenu` client component wraps the app in the root provider tree, manages open/keyboard state, builds a `CommandContext` from current app state, and calls provider functions to produce available commands filtered by auth/org scope. A `useCommandMenu()` hook exposes `open()` to shell trigger buttons. Command providers are pure functions of `CommandContext → DashboardCommand[]`, which makes them fully testable in a Node environment without DOM dependencies.

**Tech Stack:** Next.js App Router, cmdk (via `@workspace/ui/components/command`), better-auth (`authClient`), next-themes (`useTheme`), sonner (`toast`), `@workspace/routes`, `@workspace/ui/components/icon-for`, Vitest

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `apps/dashboard/features/command-menu/command-types.ts` | Shared types: `DashboardCommand`, `CommandContext`, `CommandProvider` |
| Create | `apps/dashboard/features/command-menu/command-providers.ts` | Pure provider functions + `buildCommands` composer |
| Create | `apps/dashboard/features/command-menu/__tests__/command-providers.test.ts` | Unit tests for providers and `buildCommands` |
| Create | `apps/dashboard/features/command-menu/command-menu-dialog.tsx` | Dialog rendering using `@workspace/ui/components/command` |
| Create | `apps/dashboard/features/command-menu/global-command-menu.tsx` | Context, keyboard listener, state, wraps children |
| Create | `apps/dashboard/features/command-menu/command-menu-trigger.tsx` | Search icon button that calls `useCommandMenu().open()` |
| Modify | `packages/ui/src/components/icon-for.tsx` | Add `IconForSearch` |
| Modify | `apps/dashboard/features/auth/ui/auth-provider.tsx` | Wrap children with `GlobalCommandMenu` |
| Modify | `apps/dashboard/features/dashboard/ui/dashboard-shell.tsx` | Add `CommandMenuTrigger` to header |
| Modify | `apps/dashboard/app/(organization)/[org-slug]/layout.tsx` | Add `CommandMenuTrigger` to header |

---

## Task 1: Add IconForSearch to the icon registry

**Files:**
- Modify: `packages/ui/src/components/icon-for.tsx`

The trigger button needs a search icon. `icon-for.tsx` currently imports from lucide; `Search` is not in the import list yet.

- [ ] **Step 1: Add Search to the lucide import list**

Open `packages/ui/src/components/icon-for.tsx`. The existing import block starts with:
```ts
import {
  AlertTriangle,
  ...
```
Add `Search` to the list (keep alphabetical order):
```ts
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
  Italic,
  KeyRound,
  LayoutDashboard,
  Link2,
  LogOut,
  Mail,
  Monitor,
  MoreHorizontal,
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

- [ ] **Step 2: Export IconForSearch**

Append after the last existing icon export (e.g., after `IconForAi`):
```ts
export const IconForSearch = forwardRef<SVGSVGElement, LucideProps>(
  (props, ref) => (
    <Search ref={ref} {...props} className={cn("size-4", props.className)} />
  )
);
IconForSearch.displayName = "IconForSearch";
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /Users/user/GIT/starterup-starter-template-nextjs
pnpm --filter @workspace/ui exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/icon-for.tsx
git commit -m "feat(ui): add IconForSearch to icon registry"
```

---

## Task 2: Define command types

**Files:**
- Create: `apps/dashboard/features/command-menu/command-types.ts`

Types are pure — no unit test needed; TypeScript will catch errors.

- [ ] **Step 1: Create the types file**

```ts
// apps/dashboard/features/command-menu/command-types.ts

export type Organization = {
  id: string;
  name: string;
  slug: string;
};

export type CommandContext = {
  pathname: string;
  orgSlug: string | undefined;
  user: { id: string; name: string; email: string } | null;
  organizations: Organization[];
  router: { push: (path: string) => void };
  setTheme: (theme: "light" | "dark" | "system") => void;
  signOut: () => Promise<void>;
  setActiveOrg: (orgId: string) => Promise<void>;
  searchQuery: string;
};

export type CommandGroup = "Navigation" | "Organizations" | "Account" | "Theme" | "Actions";
export type CommandScope = "public" | "auth" | "user" | "organization";
export type CommandKind =
  | "navigation"
  | "client-action"
  | "server-action-placeholder"
  | "search-result";

export type DashboardCommand = {
  id: string;
  title: string;
  subtitle?: string;
  group: CommandGroup;
  scope: CommandScope;
  kind: CommandKind;
  keywords?: string[];
  shortcut?: string;
  disabled?: boolean;
  run: (context: CommandContext) => void | Promise<void>;
};

// Supports async providers for future entity search; v1 providers return synchronously.
export type CommandProvider = (
  context: CommandContext
) => DashboardCommand[] | Promise<DashboardCommand[]>;
```

- [ ] **Step 2: Type-check the file**

```bash
cd /Users/user/GIT/starterup-starter-template-nextjs
pnpm --filter dashboard exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/features/command-menu/command-types.ts
git commit -m "feat(command-menu): add command types"
```

---

## Task 3: Write failing tests for command providers (TDD)

**Files:**
- Create: `apps/dashboard/features/command-menu/__tests__/command-providers.test.ts`

Write all tests before any implementation. They will fail because `command-providers.ts` doesn't exist yet.

- [ ] **Step 1: Create the test file**

```ts
// apps/dashboard/features/command-menu/__tests__/command-providers.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  authNavProvider,
  userProvider,
  orgNavProvider,
  orgSwitchProvider,
  buildCommands,
} from "../command-providers";
import type { CommandContext } from "../command-types";

const mockRouter = { push: vi.fn() };
const mockSetTheme = vi.fn();
const mockSignOut = vi.fn();
const mockSetActiveOrg = vi.fn();

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    pathname: "/",
    orgSlug: undefined,
    user: null,
    organizations: [],
    router: mockRouter,
    setTheme: mockSetTheme,
    signOut: mockSignOut,
    setActiveOrg: mockSetActiveOrg,
    searchQuery: "",
    ...overrides,
  };
}

const testUser = { id: "user-1", name: "Test User", email: "test@example.com" };
const testOrgs = [
  { id: "org-1", name: "Acme Inc", slug: "acme-inc" },
  { id: "org-2", name: "Beta Corp", slug: "beta-corp" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Signed-out ────────────────────────────────────────────────────────────────

describe("buildCommands - signed out", () => {
  it("returns auth navigation commands (sign-in, sign-up, forgot-password)", () => {
    const commands = buildCommands(makeContext());
    const ids = commands.map((c) => c.id);
    expect(ids).toContain("nav:sign-in");
    expect(ids).toContain("nav:sign-up");
    expect(ids).toContain("nav:forgot-password");
  });

  it("excludes user commands", () => {
    const commands = buildCommands(makeContext());
    const ids = commands.map((c) => c.id);
    expect(ids).not.toContain("user:account-settings");
    expect(ids).not.toContain("user:sign-out");
    expect(ids).not.toContain("theme:light");
  });

  it("excludes organization navigation commands", () => {
    const commands = buildCommands(makeContext());
    const ids = commands.map((c) => c.id);
    expect(ids).not.toContain("org:dashboard");
    expect(ids).not.toContain("org:members");
  });

  it("excludes org-switch commands even when organizations are present", () => {
    const commands = buildCommands(makeContext({ organizations: testOrgs }));
    const ids = commands.map((c) => c.id);
    expect(ids.some((id) => id.startsWith("org-switch:"))).toBe(false);
  });
});

// ── Signed in, no current org ─────────────────────────────────────────────────

describe("buildCommands - signed in without current org", () => {
  const ctx = makeContext({ user: testUser, organizations: testOrgs });

  it("returns account, theme, and sign-out commands", () => {
    const commands = buildCommands(ctx);
    const ids = commands.map((c) => c.id);
    expect(ids).toContain("user:account-settings");
    expect(ids).toContain("user:sign-out");
    expect(ids).toContain("theme:light");
    expect(ids).toContain("theme:dark");
    expect(ids).toContain("theme:system");
  });

  it("returns org-switch commands for loaded organizations", () => {
    const commands = buildCommands(ctx);
    const ids = commands.map((c) => c.id);
    expect(ids).toContain("org-switch:org-1");
    expect(ids).toContain("org-switch:org-2");
  });

  it("excludes auth navigation commands", () => {
    const commands = buildCommands(ctx);
    const ids = commands.map((c) => c.id);
    expect(ids).not.toContain("nav:sign-in");
    expect(ids).not.toContain("nav:sign-up");
  });

  it("excludes org-scoped navigation", () => {
    const commands = buildCommands(ctx);
    const ids = commands.map((c) => c.id);
    expect(ids).not.toContain("org:dashboard");
    expect(ids).not.toContain("org:members");
    expect(ids).not.toContain("org:billing");
    expect(ids).not.toContain("org:api-keys");
  });
});

// ── Signed in, with current org ───────────────────────────────────────────────

describe("buildCommands - signed in with current org", () => {
  const ctx = makeContext({ user: testUser, organizations: testOrgs, orgSlug: "acme-inc" });

  it("returns org navigation commands", () => {
    const commands = buildCommands(ctx);
    const ids = commands.map((c) => c.id);
    expect(ids).toContain("org:dashboard");
    expect(ids).toContain("org:ai");
    expect(ids).toContain("org:settings");
    expect(ids).toContain("org:members");
    expect(ids).toContain("org:billing");
    expect(ids).toContain("org:api-keys");
  });

  it("still returns user and theme commands", () => {
    const commands = buildCommands(ctx);
    const ids = commands.map((c) => c.id);
    expect(ids).toContain("user:account-settings");
    expect(ids).toContain("theme:light");
  });

  it("excludes auth navigation commands", () => {
    const commands = buildCommands(ctx);
    const ids = commands.map((c) => c.id);
    expect(ids).not.toContain("nav:sign-in");
  });
});

// ── Org-switch provider ───────────────────────────────────────────────────────

describe("orgSwitchProvider", () => {
  it("generates one command per organization", () => {
    const commands = orgSwitchProvider(makeContext({ user: testUser, organizations: testOrgs }));
    expect(commands).toHaveLength(2);
    expect(commands[0].id).toBe("org-switch:org-1");
    expect(commands[1].id).toBe("org-switch:org-2");
  });

  it("run calls setActiveOrg then navigates to the org", async () => {
    const ctx = makeContext({ user: testUser, organizations: testOrgs });
    const commands = orgSwitchProvider(ctx);
    await commands[0].run(ctx);
    expect(mockSetActiveOrg).toHaveBeenCalledWith("org-1");
    expect(mockRouter.push).toHaveBeenCalledWith("/acme-inc");
  });

  it("run navigates to the correct org for the second org", async () => {
    const ctx = makeContext({ user: testUser, organizations: testOrgs });
    const commands = orgSwitchProvider(ctx);
    await commands[1].run(ctx);
    expect(mockSetActiveOrg).toHaveBeenCalledWith("org-2");
    expect(mockRouter.push).toHaveBeenCalledWith("/beta-corp");
  });

  it("returns empty array when no user", () => {
    const commands = orgSwitchProvider(makeContext({ user: null, organizations: testOrgs }));
    expect(commands).toHaveLength(0);
  });

  it("returns empty array when organizations list is empty", () => {
    const commands = orgSwitchProvider(makeContext({ user: testUser, organizations: [] }));
    expect(commands).toHaveLength(0);
  });
});

// ── orgNavProvider ────────────────────────────────────────────────────────────

describe("orgNavProvider", () => {
  it("returns empty array when orgSlug is absent", () => {
    const commands = orgNavProvider(makeContext({ user: testUser }));
    expect(commands).toHaveLength(0);
  });

  it("org:dashboard run navigates to org root", () => {
    const ctx = makeContext({ user: testUser, orgSlug: "acme-inc" });
    const commands = orgNavProvider(ctx);
    const cmd = commands.find((c) => c.id === "org:dashboard")!;
    cmd.run(ctx);
    expect(mockRouter.push).toHaveBeenCalledWith("/acme-inc");
  });

  it("org:ai run navigates to org ai page", () => {
    const ctx = makeContext({ user: testUser, orgSlug: "acme-inc" });
    const commands = orgNavProvider(ctx);
    const cmd = commands.find((c) => c.id === "org:ai")!;
    cmd.run(ctx);
    expect(mockRouter.push).toHaveBeenCalledWith("/acme-inc/ai");
  });

  it("org:members run navigates to members page", () => {
    const ctx = makeContext({ user: testUser, orgSlug: "acme-inc" });
    const commands = orgNavProvider(ctx);
    const cmd = commands.find((c) => c.id === "org:members")!;
    cmd.run(ctx);
    expect(mockRouter.push).toHaveBeenCalledWith("/acme-inc/settings/members");
  });

  it("org:billing run navigates to billing page", () => {
    const ctx = makeContext({ user: testUser, orgSlug: "acme-inc" });
    const commands = orgNavProvider(ctx);
    const cmd = commands.find((c) => c.id === "org:billing")!;
    cmd.run(ctx);
    expect(mockRouter.push).toHaveBeenCalledWith("/acme-inc/settings/billing");
  });

  it("org:api-keys run navigates to api keys page", () => {
    const ctx = makeContext({ user: testUser, orgSlug: "acme-inc" });
    const commands = orgNavProvider(ctx);
    const cmd = commands.find((c) => c.id === "org:api-keys")!;
    cmd.run(ctx);
    expect(mockRouter.push).toHaveBeenCalledWith("/acme-inc/settings/api-keys");
  });
});

// ── Command ID uniqueness ─────────────────────────────────────────────────────

describe("command ID uniqueness", () => {
  it("IDs are unique in signed-out context", () => {
    const commands = buildCommands(makeContext());
    const ids = commands.map((c) => c.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("IDs are unique in signed-in context without org", () => {
    const commands = buildCommands(makeContext({ user: testUser, organizations: testOrgs }));
    const ids = commands.map((c) => c.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("IDs are unique in signed-in context with org", () => {
    const commands = buildCommands(
      makeContext({ user: testUser, organizations: testOrgs, orgSlug: "acme-inc" })
    );
    const ids = commands.map((c) => c.id);
    expect(ids.length).toBe(new Set(ids).size);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail (module not found)**

```bash
cd /Users/user/GIT/starterup-starter-template-nextjs
pnpm --filter dashboard exec vitest run features/command-menu
```
Expected: FAIL — "Cannot find module '../command-providers'"

- [ ] **Step 3: Commit tests**

```bash
git add apps/dashboard/features/command-menu/__tests__/command-providers.test.ts
git commit -m "test(command-menu): add failing tests for command providers"
```

---

## Task 4: Implement command providers to pass tests

**Files:**
- Create: `apps/dashboard/features/command-menu/command-providers.ts`

- [ ] **Step 1: Create command-providers.ts**

```ts
// apps/dashboard/features/command-menu/command-providers.ts
import {
  getPathForSignIn,
  getPathForSignUp,
  getPathForForgotPassword,
  getPathForAccountSettings,
  getPathForOrg,
  getPathForOrgSettings,
  getPathForOrgMembers,
} from "@workspace/routes";
import type { CommandContext, DashboardCommand } from "./command-types";

export function authNavProvider(_context: CommandContext): DashboardCommand[] {
  return [
    {
      id: "nav:sign-in",
      title: "Sign In",
      group: "Navigation",
      scope: "auth",
      kind: "navigation",
      keywords: ["login", "sign in", "enter"],
      run: (ctx) => ctx.router.push(getPathForSignIn()),
    },
    {
      id: "nav:sign-up",
      title: "Sign Up",
      group: "Navigation",
      scope: "auth",
      kind: "navigation",
      keywords: ["register", "create account"],
      run: (ctx) => ctx.router.push(getPathForSignUp()),
    },
    {
      id: "nav:forgot-password",
      title: "Forgot Password",
      group: "Navigation",
      scope: "auth",
      kind: "navigation",
      keywords: ["reset password", "recover"],
      run: (ctx) => ctx.router.push(getPathForForgotPassword()),
    },
  ];
}

export function userProvider(_context: CommandContext): DashboardCommand[] {
  return [
    {
      id: "user:account-settings",
      title: "Account Settings",
      group: "Account",
      scope: "user",
      kind: "navigation",
      keywords: ["profile", "account", "settings"],
      run: (ctx) => ctx.router.push(getPathForAccountSettings()),
    },
    {
      id: "theme:light",
      title: "Light Theme",
      group: "Theme",
      scope: "user",
      kind: "client-action",
      keywords: ["theme", "light", "appearance"],
      run: (ctx) => ctx.setTheme("light"),
    },
    {
      id: "theme:dark",
      title: "Dark Theme",
      group: "Theme",
      scope: "user",
      kind: "client-action",
      keywords: ["theme", "dark", "appearance"],
      run: (ctx) => ctx.setTheme("dark"),
    },
    {
      id: "theme:system",
      title: "System Theme",
      group: "Theme",
      scope: "user",
      kind: "client-action",
      keywords: ["theme", "system", "auto", "appearance"],
      run: (ctx) => ctx.setTheme("system"),
    },
    {
      id: "user:sign-out",
      title: "Sign Out",
      group: "Actions",
      scope: "user",
      kind: "client-action",
      keywords: ["logout", "sign out"],
      run: async (ctx) => {
        await ctx.signOut();
        ctx.router.push(getPathForSignIn());
      },
    },
  ];
}

export function orgNavProvider(context: CommandContext): DashboardCommand[] {
  if (!context.orgSlug) return [];
  const { orgSlug } = context;
  return [
    {
      id: "org:dashboard",
      title: "Organization Dashboard",
      group: "Navigation",
      scope: "organization",
      kind: "navigation",
      keywords: ["dashboard", "home", "org"],
      run: (ctx) => ctx.router.push(getPathForOrg(orgSlug)),
    },
    {
      id: "org:ai",
      title: "AI Assistant",
      group: "Navigation",
      scope: "organization",
      kind: "navigation",
      keywords: ["ai", "assistant", "chat"],
      run: (ctx) => ctx.router.push(`${getPathForOrg(orgSlug)}/ai`),
    },
    {
      id: "org:settings",
      title: "Organization Settings",
      group: "Navigation",
      scope: "organization",
      kind: "navigation",
      keywords: ["settings", "general", "org"],
      run: (ctx) => ctx.router.push(getPathForOrgSettings(orgSlug)),
    },
    {
      id: "org:members",
      title: "Members",
      group: "Navigation",
      scope: "organization",
      kind: "navigation",
      keywords: ["members", "people", "team"],
      run: (ctx) => ctx.router.push(getPathForOrgMembers(orgSlug)),
    },
    {
      id: "org:billing",
      title: "Billing",
      group: "Navigation",
      scope: "organization",
      kind: "navigation",
      keywords: ["billing", "payment", "subscription"],
      run: (ctx) => ctx.router.push(`${getPathForOrg(orgSlug)}/settings/billing`),
    },
    {
      id: "org:api-keys",
      title: "API Keys",
      group: "Navigation",
      scope: "organization",
      kind: "navigation",
      keywords: ["api", "keys", "tokens", "access"],
      run: (ctx) => ctx.router.push(`${getPathForOrg(orgSlug)}/settings/api-keys`),
    },
  ];
}

export function orgSwitchProvider(context: CommandContext): DashboardCommand[] {
  if (!context.user || context.organizations.length === 0) return [];
  return context.organizations.map((org) => ({
    id: `org-switch:${org.id}`,
    title: org.name,
    subtitle: org.slug,
    group: "Organizations" as const,
    scope: "user" as const,
    kind: "client-action" as const,
    keywords: ["switch", "organization", org.name, org.slug],
    run: async (ctx) => {
      await ctx.setActiveOrg(org.id);
      ctx.router.push(getPathForOrg(org.slug));
    },
  }));
}

function filterByScope(
  commands: DashboardCommand[],
  context: CommandContext
): DashboardCommand[] {
  const isSignedIn = !!context.user;
  const hasOrg = isSignedIn && !!context.orgSlug;
  return commands.filter((cmd) => {
    if (cmd.scope === "public") return true;
    if (cmd.scope === "auth") return !isSignedIn;
    if (cmd.scope === "user") return isSignedIn;
    if (cmd.scope === "organization") return hasOrg;
    return false;
  });
}

export function buildCommands(context: CommandContext): DashboardCommand[] {
  const all = [
    ...authNavProvider(context),
    ...userProvider(context),
    ...orgNavProvider(context),
    ...orgSwitchProvider(context),
  ];
  return filterByScope(all, context);
}
```

- [ ] **Step 2: Run tests to confirm they pass**

```bash
cd /Users/user/GIT/starterup-starter-template-nextjs
pnpm --filter dashboard exec vitest run features/command-menu
```
Expected: all tests PASS.

- [ ] **Step 3: Type-check**

```bash
pnpm --filter dashboard exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/features/command-menu/command-providers.ts
git commit -m "feat(command-menu): implement command providers"
```

---

## Task 5: Implement command menu dialog

**Files:**
- Create: `apps/dashboard/features/command-menu/command-menu-dialog.tsx`

This is a thin rendering layer over `@workspace/ui/components/command`. No unit tests (requires jsdom); verify visually in Task 10.

- [ ] **Step 1: Create command-menu-dialog.tsx**

```tsx
// apps/dashboard/features/command-menu/command-menu-dialog.tsx
"use client";

import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@workspace/ui/components/command";
import type { DashboardCommand } from "./command-types";

const GROUPS = [
  "Navigation",
  "Organizations",
  "Account",
  "Theme",
  "Actions",
] as const;

interface CommandMenuDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: DashboardCommand[];
  onSelect: (command: DashboardCommand) => void;
}

export function CommandMenuDialog({
  open,
  onOpenChange,
  commands,
  onSelect,
}: CommandMenuDialogProps) {
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No commands found.</CommandEmpty>
        {GROUPS.map((group) => {
          const groupCommands = commands.filter((c) => c.group === group);
          if (groupCommands.length === 0) return null;
          return (
            <CommandGroup key={group} heading={group}>
              {groupCommands.map((command) => (
                <CommandItem
                  key={command.id}
                  value={[
                    command.title,
                    command.subtitle,
                    ...(command.keywords ?? []),
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onSelect={() => onSelect(command)}
                  disabled={command.disabled}
                >
                  {command.title}
                  {command.subtitle && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {command.subtitle}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter dashboard exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/features/command-menu/command-menu-dialog.tsx
git commit -m "feat(command-menu): add command menu dialog component"
```

---

## Task 6: Implement GlobalCommandMenu with context

**Files:**
- Create: `apps/dashboard/features/command-menu/global-command-menu.tsx`

This component provides an `open()` function via React context and renders `CommandMenuDialog` as a sibling to children (not a modal portal issue — `CommandDialog` already uses a Radix portal).

- [ ] **Step 1: Create global-command-menu.tsx**

```tsx
// apps/dashboard/features/command-menu/global-command-menu.tsx
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useTheme } from "@workspace/ui/components/theme-provider";
import { toast } from "@workspace/ui/components/sonner";
import { authClient } from "@workspace/auth/client";
import { getPathForSignIn } from "@workspace/routes";
import { buildCommands } from "./command-providers";
import { CommandMenuDialog } from "./command-menu-dialog";
import type { CommandContext, DashboardCommand } from "./command-types";

type CommandMenuContextValue = { open: () => void };

const CommandMenuContext = createContext<CommandMenuContextValue>({
  open: () => {},
});

export function useCommandMenu() {
  return useContext(CommandMenuContext);
}

export function GlobalCommandMenu({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ "org-slug"?: string }>();
  const { setTheme } = useTheme();
  const { data: session } = authClient.useSession();
  const { data: orgsData } = authClient.useListOrganizations();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const context: CommandContext = {
    pathname,
    orgSlug: params["org-slug"],
    user: session?.user ?? null,
    organizations: orgsData ?? [],
    router,
    setTheme,
    signOut: async () => {
      await authClient.signOut();
      router.push(getPathForSignIn());
    },
    setActiveOrg: async (orgId: string) => {
      const result = await authClient.organization.setActive({
        organizationId: orgId,
      });
      if (result.error) {
        throw new Error(
          result.error.message ?? "Failed to switch organization"
        );
      }
    },
    searchQuery: "",
  };

  const commands = buildCommands(context);

  const handleSelect = async (command: DashboardCommand) => {
    setIsOpen(false);
    try {
      await command.run(context);
    } catch {
      toast.error("Something went wrong. Please try again.");
    }
  };

  return (
    <CommandMenuContext.Provider value={{ open: () => setIsOpen(true) }}>
      {children}
      <CommandMenuDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        commands={commands}
        onSelect={handleSelect}
      />
    </CommandMenuContext.Provider>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter dashboard exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/features/command-menu/global-command-menu.tsx
git commit -m "feat(command-menu): add GlobalCommandMenu provider with keyboard listener"
```

---

## Task 7: Implement CommandMenuTrigger

**Files:**
- Create: `apps/dashboard/features/command-menu/command-menu-trigger.tsx`

- [ ] **Step 1: Create command-menu-trigger.tsx**

```tsx
// apps/dashboard/features/command-menu/command-menu-trigger.tsx
"use client";

import { Button } from "@workspace/ui/components/button";
import { IconForSearch } from "@workspace/ui/components/icon-for";
import { useCommandMenu } from "./global-command-menu";

interface CommandMenuTriggerProps {
  className?: string;
}

export function CommandMenuTrigger({ className }: CommandMenuTriggerProps) {
  const { open } = useCommandMenu();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={open}
      aria-label="Open command menu (⌘K)"
      className={className}
    >
      <IconForSearch />
    </Button>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter dashboard exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/features/command-menu/command-menu-trigger.tsx
git commit -m "feat(command-menu): add CommandMenuTrigger button"
```

---

## Task 8: Mount GlobalCommandMenu in the root providers

**Files:**
- Modify: `apps/dashboard/features/auth/ui/auth-provider.tsx`

`GlobalCommandMenu` must sit inside `ThemeProvider` (it calls `useTheme`) and inside `NiceModal.Provider` (so future commands can open modals).

- [ ] **Step 1: Update auth-provider.tsx**

Current file:
```tsx
"use client";

import NiceModal from "@ebay/nice-modal-react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@workspace/ui/components/theme-provider";
import { Toaster } from "@workspace/ui/components/sonner";
import type { ReactNode } from "react";
import { getQueryClient } from "../data/query-client";

export function Providers({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <NiceModal.Provider>
          {children}
        </NiceModal.Provider>
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
```

Replace with:
```tsx
"use client";

import NiceModal from "@ebay/nice-modal-react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@workspace/ui/components/theme-provider";
import { Toaster } from "@workspace/ui/components/sonner";
import type { ReactNode } from "react";
import { getQueryClient } from "../data/query-client";
import { GlobalCommandMenu } from "@/features/command-menu/global-command-menu";

export function Providers({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <NiceModal.Provider>
          <GlobalCommandMenu>
            {children}
          </GlobalCommandMenu>
        </NiceModal.Provider>
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter dashboard exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/features/auth/ui/auth-provider.tsx
git commit -m "feat(command-menu): mount GlobalCommandMenu in root providers"
```

---

## Task 9: Add CommandMenuTrigger to the dashboard shell header

**Files:**
- Modify: `apps/dashboard/features/dashboard/ui/dashboard-shell.tsx`

The dashboard shell is used for authenticated non-org routes (account settings etc.).

- [ ] **Step 1: Update dashboard-shell.tsx**

Add import after existing imports:
```tsx
import { CommandMenuTrigger } from "@/features/command-menu/command-menu-trigger";
```

In the header, add `<CommandMenuTrigger />` before `<ThemeToggle />`:
```tsx
<header className="flex h-16 items-center justify-end gap-2 border-b px-6">
  <CommandMenuTrigger />
  <ThemeToggle />
  <DropdownMenu>
    {/* existing dropdown unchanged */}
  </DropdownMenu>
</header>
```

The full updated file:
```tsx
"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/features/auth/data/auth-client";
import { getPathForSignIn } from "@workspace/routes";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Button } from "@workspace/ui/components/button";
import { ThemeToggle } from "@workspace/ui/components/theme-toggle";
import { IconForSignOut } from "@workspace/ui/components/icon-for";
import { CommandMenuTrigger } from "@/features/command-menu/command-menu-trigger";

interface DashboardShellProps {
  user: { name: string; image?: string | null };
  children: React.ReactNode;
}

export function DashboardShell({ user, children }: DashboardShellProps) {
  const router = useRouter();

  const displayName = user.name || "User";
  const displayImage = user.image ?? "";

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push(getPathForSignIn());
  };

  return (
    <div className="min-h-screen">
      <header className="flex h-16 items-center justify-end gap-2 border-b px-6">
        <CommandMenuTrigger />
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <Avatar className="size-8">
                <AvatarImage src={displayImage} alt={displayName} />
                <AvatarFallback>
                  {displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={handleSignOut}>
              <IconForSignOut className="mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <main className="mx-auto max-w-2xl px-6 py-10">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter dashboard exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/features/dashboard/ui/dashboard-shell.tsx
git commit -m "feat(command-menu): add search trigger to dashboard shell header"
```

---

## Task 10: Add CommandMenuTrigger to the org layout header

**Files:**
- Modify: `apps/dashboard/app/(organization)/[org-slug]/layout.tsx`

- [ ] **Step 1: Update the org layout**

Add import after existing imports:
```tsx
import { CommandMenuTrigger } from "@/features/command-menu/command-menu-trigger";
```

Update the header to add `<CommandMenuTrigger />` after the separator:
```tsx
<header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
  <SidebarTrigger className="-ml-1" />
  <Separator orientation="vertical" className="mr-2 h-4" />
  <CommandMenuTrigger />
</header>
```

The full updated file:
```tsx
"use client";

import { use } from "react";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@workspace/ui/components/sidebar";
import { Separator } from "@workspace/ui/components/separator";
import { AppSidebar } from "@/common/ui/app-sidebar";
import { OrgProvider } from "@/features/organization/ui/org-provider";
import { orgNavConfig } from "./nav-items-org";
import { CommandMenuTrigger } from "@/features/command-menu/command-menu-trigger";

export default function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ "org-slug": string }>;
}) {
  const { "org-slug": orgSlug } = use(params);

  return (
    <OrgProvider orgSlug={orgSlug}>
      <SidebarProvider>
        <AppSidebar navConfig={orgNavConfig} />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <CommandMenuTrigger />
          </header>
          <main className="flex-1 p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </OrgProvider>
  );
}
```

- [ ] **Step 2: Run all tests to confirm nothing broke**

```bash
cd /Users/user/GIT/starterup-starter-template-nextjs
pnpm --filter dashboard exec vitest run
```
Expected: all tests PASS.

- [ ] **Step 3: Full type-check**

```bash
pnpm --filter dashboard exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/dashboard/app/(organization)/[org-slug]/layout.tsx"
git commit -m "feat(command-menu): add search trigger to org layout header"
```

---

## Manual Verification Checklist

After all tasks are committed, start the dev server and verify:

```bash
pnpm --filter dashboard dev
```

1. **Keyboard shortcut**: Press `Cmd+K` (macOS) or `Ctrl+K` — command palette opens.
2. **Toggle**: Press `Cmd+K` again — palette closes.
3. **Escape**: Press Escape — palette closes.
4. **Signed-out view** (visit `/sign-in` without a session): palette shows Sign In, Sign Up, Forgot Password.
5. **Signed-in view**: palette shows Account Settings, theme commands, Sign Out, and org-switch items.
6. **Org view** (visit `/<org-slug>`): palette also shows org navigation commands (Dashboard, AI Assistant, Settings, Members, Billing, API Keys).
7. **Trigger buttons**: search icon appears in dashboard shell header and org layout header; clicking opens the palette.
8. **Theme commands**: selecting Light/Dark/System theme changes the app theme immediately.
9. **Sign Out command**: closes palette, signs out, navigates to `/sign-in`.
10. **Org switch**: selecting a different org switches active org and navigates to that org's root.
11. **Repeated keydown**: holding `Cmd+K` doesn't flicker the palette (repeat events ignored).

---

## Self-Review

**Spec coverage check:**
- ✅ `Cmd+K` / `Ctrl+K` global shortcut — Task 6 keyboard listener
- ✅ Visible trigger in shells — Tasks 9, 10
- ✅ Signed-out users see auth commands — `authNavProvider`, scope filter
- ✅ Signed-in users see account, theme, sign-out, org-switch — `userProvider`, `orgSwitchProvider`
- ✅ Org commands only when orgSlug present — `orgNavProvider`, scope filter
- ✅ Future async providers — `CommandProvider` type supports `Promise<DashboardCommand[]>`
- ✅ MCP not exposed — no MCP surface added
- ✅ Server-executed commands not in v1 — `server-action-placeholder` kind is type-only
- ✅ `@workspace/ui/components/command` primitives used — Task 5
- ✅ Icon registry used — `IconForSearch` in registry, used in trigger
- ✅ Empty state — `CommandEmpty` in dialog
- ✅ Groups: Navigation, Organizations, Account, Theme, Actions — dialog renders in order
- ✅ Failed org-switch shows toast — `handleSelect` catch block
- ✅ Menu closes before command runs — `setIsOpen(false)` before `command.run()`

**Placeholder scan:** No TBD, TODO, or vague steps — all code blocks are complete.

**Type consistency:**
- `buildCommands` in Task 4 matches import in Task 6 ✅
- `CommandMenuDialog` props in Task 5 match usage in Task 6 ✅
- `useCommandMenu().open` in Task 7 matches context shape in Task 6 ✅
- `DashboardCommand` type used consistently across all files ✅
