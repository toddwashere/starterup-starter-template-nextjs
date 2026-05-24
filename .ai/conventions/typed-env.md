# Typed Env Convention

Critical-path packages and apps expose a `keys.ts` at their root that validates environment variables with Zod.

## Pattern

```typescript
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  // Optional vars:
  OPTIONAL_VAR: z.string().optional(),
  // Vars with defaults:
  PORT: z.coerce.number().int().positive().default(4000),
});

export function keys() {
  return schema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    // ...
  });
}
```

## Scope

These units own a `keys.ts`:

| Unit | Vars |
|------|------|
| `packages/database` | `DATABASE_URL` |
| `packages/auth` | Auth URLs, OAuth vars |
| `packages/billing` | Stripe keys |
| `packages/worker-queue` | Queue adapter, queue name |
| `packages/ai` | AI API keys |
| `packages/email` | Email API key |
| `apps/dashboard` | Dashboard URLs |
| `apps/www` | WWW public URLs |
| `apps/public-api` | API port |
| `apps/public-mcp` | MCP URL |
| `apps/workers` | Worker health/poll vars |
| `apps/email-preview` | Preview port |

## Rules

1. All `process.env` reads in scoped units go through `keys()`.
2. Optional integration vars use `.optional()` — app works without them locally.
3. `NEXT_PUBLIC_*` vars live in **app** `keys.ts` (`dashboard`, `www`), not server-only packages.
4. Packages export only `keys()`. Apps may additionally export typed helpers derived from `keys()`.
5. Follow the pattern in `packages/email/keys.ts` and `packages/worker-queue/keys.ts`.

## validate:env

`pnpm validate:env` loads `.env.example` and calls `keys()` for every scoped unit.

Run it locally to verify `.env.example` stays in sync. CI will run it too.

## When adding env vars

Update both `keys.ts` (schema + mapping) and `.env.example` (with safe placeholder or commented optional) in the same PR.

## Out of scope (v1)

- Leaf packages: `contacts`, `ui`, `common`, `routes`, `tool-calls`
- ESLint rule for raw `process.env` (planned follow-up)
