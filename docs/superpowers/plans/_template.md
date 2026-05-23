# [Feature Name] Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [One sentence — what ships when this plan is done.]

**Architecture:** [How it fits the monorepo: apps, packages, data flow.]

**Tech Stack:** [Libraries, apps, and packages touched.]

**Design spec (if any):** [`docs/superpowers/specs/YYYY-MM-DD-feature-design.md`](../specs/YYYY-MM-DD-feature-design.md)

---

## File Structure

[List create/modify paths before tasks.]

## Critical Tests

**Required.** Identify high-value **unit** tests before the task breakdown. See [`.ai/conventions/critical-tests-in-plans.md`](../../../.ai/conventions/critical-tests-in-plans.md).

Focus on boundary conditions, integration points between components, failure modes, and state transitions — not trivial happy-path renders.

- `path/to/module.test.ts`: [what behavior must hold — e.g. auth guard rejects cross-org access]
- `path/to/other.test.ts`: [ … ]

Avoid low-value tests. Use colocated paths only (no `__tests__/` folders).

## Task 1: [First task title]

**Files:**

- Create/Modify: `path/to/file.ts`

- [ ] **Step 1: [Description]**

[Continue with additional tasks…]
