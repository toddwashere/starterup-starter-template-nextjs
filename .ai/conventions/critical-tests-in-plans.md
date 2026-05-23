# Critical Tests in Plans

When creating or updating implementation plans (`docs/superpowers/plans/`) or design specs (`docs/superpowers/specs/`), **always** include a `## Critical Tests` section.

## Requirement

- **Heading:** exactly `## Critical Tests` (plans and specs).
- **Placement:** after overview / file structure / design sections, **before** the task breakdown (plans) or before closing verification-only sections (specs).
- **Content:** named, colocated unit test files and the behaviors they must prove — not a vague “add tests later.”

Start from the templates:

- Plans: [`docs/superpowers/plans/_template.md`](../../docs/superpowers/plans/_template.md)
- Specs: [`docs/superpowers/specs/_template.md`](../../docs/superpowers/specs/_template.md)

A plan or spec without `## Critical Tests` is incomplete.

## What to include

Focus on tests that give the most confidence if they pass:

- Boundary conditions and edge cases
- Integration points between components
- Failure modes and error paths
- State transitions

Favor **unit** tests that run quickly. Avoid listing trivial happy-path assertions or low-value “renders without crashing” checks.

List test file paths colocated beside implementation (for example `contact-actions.test.ts` next to `contact-actions.ts`). Never plan or add `__tests__` folders — see [`colocated-tests.md`](./colocated-tests.md).

## Example entry format

```markdown
## Critical Tests

- `packages/contacts/src/services/contact-tag-service.test.ts`: sync replaces tags atomically; rejects duplicate names; scopes by orgId.
- `apps/dashboard/features/contacts/contact/data/contact-actions.test.ts`: create/update enforce org membership; invalid input returns field errors.
```

## During implementation

Implement the listed tests (or update the plan if scope changes). Do not ship the feature with zero coverage of the critical behaviors identified in the plan.
