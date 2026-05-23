# [Feature Name]

**Date:** YYYY-MM-DD  
**Status:** Draft | Approved

## Overview

[Problem, scope, and outcome in a few sentences.]

---

## [Section 1 — design area]

[Requirements, API, UI, data model, etc.]

## Critical Tests

**Required.** Identify high-value **unit** tests the implementation plan must cover. See [`.ai/conventions/critical-tests-in-plans.md`](../../../.ai/conventions/critical-tests-in-plans.md).

Focus on boundary conditions, integration points, failure modes, and state transitions — not trivial happy-path assertions.

- `path/to/module.test.ts`: [what behavior must hold]
- `path/to/other.test.ts`: [ … ]

List colocated test paths only (no `__tests__/` folders). Favor fast unit tests over E2E unless a journey is the main risk.

## Verification

- `pnpm type-check`
- `pnpm lint`
- [Targeted test commands]
