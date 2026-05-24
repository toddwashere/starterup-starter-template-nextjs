# Shared AI Guidance

This folder contains canonical project guidance for AI coding agents.

Tool-specific folders such as `.cursor/` and `.claude/` should keep only lightweight references or wrappers when possible. The durable instructions should live here (`.ai/`) so all agents follow the same project conventions.

Entry points for agents: [../AGENTS.md](../AGENTS.md) and [`.cursor/rules/shared-ai-guidance.mdc`](../.cursor/rules/shared-ai-guidance.mdc).

## Skills

- [`skills/add-data-model-to-database/SKILL.md`](./skills/add-data-model-to-database/SKILL.md) - Prisma schema, domain-owned repositories, and database access patterns.
- [`skills/add-icon/SKILL.md`](./skills/add-icon/SKILL.md) - Centralized icon registry; never import `lucide-react` in app code.
- [`skills/add-modal-or-confirm-dialog/SKILL.md`](./skills/add-modal-or-confirm-dialog/SKILL.md) - Modals, confirm dialogs, and overlay UI using NiceModal.
- [`skills/add-new-app/SKILL.md`](./skills/add-new-app/SKILL.md) - Add a runnable app under `apps/` (ports, Turborepo, package setup).
- [`skills/add-new-page/SKILL.md`](./skills/add-new-page/SKILL.md) - Sparse routes and feature folders for dashboard and www pages.
- [`skills/create-data-table/SKILL.md`](./skills/create-data-table/SKILL.md) - Paginated data tables with mobile card lists, cross-page selection, and bulk actions.
- [`skills/create-skill/SKILL.md`](./skills/create-skill/SKILL.md) - Create project-level skills (canonical `.ai/` + tool wrappers).
- [`skills/grill-me-matt/SKILL.md`](./skills/grill-me-matt/SKILL.md) - Stress-test a plan or design via relentless one-at-a-time questioning until shared understanding.

## Conventions

- [`conventions/ai-guidance-files.md`](./conventions/ai-guidance-files.md) - Three-tier pattern for AI guidance files (.ai/ canonical, .cursor/ and .claude/ as references).
- [`conventions/critical-tests-in-plans.md`](./conventions/critical-tests-in-plans.md) - Require `## Critical Tests` in all plans and specs (templates: [`docs/superpowers/plans/_template.md`](../docs/superpowers/plans/_template.md), [`docs/superpowers/specs/_template.md`](../docs/superpowers/specs/_template.md)).
- [`conventions/colocated-tests.md`](./conventions/colocated-tests.md) - Place unit tests beside implementation files; never use `__tests__` folders.
- [`conventions/plan-archival.md`](./conventions/plan-archival.md) - Move completed plans and specs to `done/` subdirectories.
- [`conventions/format-date.md`](./conventions/format-date.md) - Always use `formatDate()` from `@workspace/common`; never call `.toLocaleString()` directly in UI code.
