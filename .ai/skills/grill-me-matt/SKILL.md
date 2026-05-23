---
name: grill-me
description: >-
  Interview the user relentlessly about a plan or design until reaching shared
  understanding, resolving each branch of the decision tree. Use when user
  wants to stress-test a plan, get grilled on their design, or mentions "grill me".
---

# Grill Me

## Purpose

Use this skill when the user wants to stress-test a plan, design, or spec before implementation. The agent acts as a rigorous interviewer: one question at a time, walking the decision tree branch by branch until every dependency is resolved and both parties share the same understanding.

Do not start implementing. Do not write code. The deliverable is a clarified, agreed design.

## Core Behavior

Interview the user relentlessly about every aspect of the plan until you reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions **one at a time**.

If a question can be answered by exploring the codebase, explore the codebase instead of asking the user.

## When to Activate

- User says "grill me", "/grill-me-matt", or similar
- User asks to stress-test a plan or design
- User shares a spec or plan and wants it challenged before building
- User wants to resolve open design questions systematically

## Workflow

### 1. Establish scope

Identify what is being grilled:

- A spec in `docs/superpowers/specs/`
- A plan in `docs/superpowers/plans/`
- An inline design described in chat
- A feature area referenced by file path or ticket

Read the source material fully before asking the first question.

### 2. Map the decision tree

Before questioning, mentally outline the major branches:

- **Scope** — what is in / out
- **Data model** — entities, relationships, ownership
- **API / boundaries** — packages, apps, repos, external services
- **UX / flows** — user paths, error states, empty states
- **Edge cases** — failure modes, permissions, concurrency
- **Testing** — critical tests, colocated paths
- **Rollout** — migrations, feature flags, backwards compatibility

Pick the highest-dependency unresolved branch first (the decision that blocks other decisions).

### 3. Ask one question at a time

Each turn:

1. Ask **exactly one** focused question.
2. Provide your **recommended answer** with brief rationale.
3. Wait for the user's response before continuing.

Do not batch multiple questions. Do not skip ahead to implementation.

### 4. Explore the codebase when possible

Before asking the user, check whether the answer already exists in the repo:

- Existing patterns in similar features
- Prisma models and repositories
- Route helpers in `packages/routes`
- UI components in `packages/ui`
- Prior specs or plans in `docs/superpowers/`
- ESLint rules and architecture invariants in `.cursor/rules/`

If you find the answer, state what you found and confirm it applies to this plan — do not ask the user to repeat what the codebase already encodes.

### 5. Resolve and record

When the user confirms or corrects your recommendation:

- Mark that branch resolved.
- Note any constraints that affect downstream branches.
- Move to the next unresolved branch.

When all branches are resolved, summarize the shared understanding in a concise bullet list. Ask the user to confirm before ending the session.

## Question Format

Use this structure every turn:

```
**Question:** <single, specific question>

**My recommendation:** <your proposed answer and why>

**Why this matters:** <which downstream decisions this unblocks or constrains>
```

Keep questions concrete. Bad: "How should auth work?" Good: "Should org admins be able to cancel another member's subscription, or only their own?"

## Rules

- **One question per message.** Never ask two questions in the same turn.
- **Always recommend.** Do not ask open-ended questions without a proposed answer.
- **Codebase first.** Explore before asking when the repo likely holds the answer.
- **No implementation.** Do not write code, create files, or start tasks during the grill session unless the user explicitly pivots.
- **Follow project conventions.** When recommending, align with `.ai/` skills, architecture invariants, and existing patterns.
- **Respect confirmed decisions.** Do not re-litigate branches the user has already resolved unless they introduce a new contradiction.

## Exit Criteria

The grill session is complete when:

1. Every major branch of the decision tree has an explicit answer.
2. No unresolved dependencies remain between decisions.
3. The user confirms the summary of shared understanding.

Offer next steps only after confirmation (e.g. write a spec, update an existing plan, begin implementation).

## Checklist

- [ ] Read the plan/spec/source material before the first question
- [ ] Map decision tree branches and pick highest-dependency item first
- [ ] Ask one question at a time with a recommended answer
- [ ] Explore codebase instead of asking when the answer is discoverable
- [ ] Summarize shared understanding and get user confirmation before closing
