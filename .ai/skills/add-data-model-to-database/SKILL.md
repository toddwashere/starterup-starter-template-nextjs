---
name: add-data-model-to-database
description: Add or change Prisma data models and repository files using this project's centralized schema and domain-owned repository conventions. Use when adding database tables, Prisma models, CRUD repositories, model repos, contacts models, billing models, auth-related models, or changing database access patterns.
---

# Add Data Model To Database

## Purpose

Use this skill whenever adding, changing, or removing persisted data models. The project uses centralized Prisma schema files, but domain-owned repository files.

## Core Rule

Schema is centralized. Repositories are domain-owned. Apps should never import Prisma directly.

ESLint blocks `@workspace/database`, `@workspace/database/client`, and `@prisma/client` imports in `apps/dashboard` and `apps/www` via `tooling/eslint/apps-architecture.js`.

## Before Editing

1. Identify the domain that owns the model: `auth`, `contacts`, `billing`, `ai`, or another package.
2. Read the relevant plan section in `plans/saas-starter-template-plan.md`, especially Data Management Patterns.
3. Check existing schema files in `packages/database/prisma/`.
4. Check existing repos in the owning package's `src/data-models/` folder.
5. If the model does not clearly fit an existing domain, ask before creating a new schema file or package.
6. If a plan says it depends on the CRM-to-contacts rename, verify that `packages/crm` has become `packages/contacts`, `crm.prisma` has become `contacts.prisma`, imports use `@workspace/contacts`, and ID prefix types use `ContactsIdPrefix` naming before continuing.

## Prisma Schema Location

Keep Prisma schema centralized in `packages/database/prisma/`. Split it into a small number of coarse domain files:

- `schema.prisma` - Prisma generator, datasource, and shared enums.
- `auth.prisma` - Everything Better Auth gives us, including core auth, organization, admin, OAuth provider tables, API keys, JWKS, and optional 2FA schema.
- `contacts.prisma` - Contact-management reusable models such as contacts, companies, street addresses, and related records.
- `billing.prisma` - Stripe subscriptions, products, prices, invoices, app billing state, and payment-provider integration records such as Stripe and Square.
- `ai.prisma` - AI chat threads and messages, plus MCP tool call audit logs.
- `domain.prisma` - Any other domain specific items that do not fit in the other files should go here.

If none of the existing `*.prisma` schema files makes sense, put it in the `domain.prisma` file

Do not put Prisma schema inside domain packages such as `packages/auth` or `packages/billing`. Domain packages own behavior and repositories, not migrations or generated Prisma schema.

Keep domain files coarse. Do not create a separate Prisma schema file for every feature or table. If two schema files are tightly coupled and owned by the same package, merge them into the same domain file. For example, Better Auth OAuth provider tables belong in `auth.prisma`, not a separate `oauth.prisma`.

## Repository Location

Use a `src/data-models/` folder inside the owning domain package. Repository files use `<database-table-name>-repo.ts` naming.

Examples:

- `packages/contacts/src/data-models/contact-repo.ts`
- `packages/contacts/src/data-models/street-address-repo.ts`
- `packages/billing/src/data-models/subscription-repo.ts`
- `packages/auth/src/data-models/member-repo.ts`
- `packages/ai/src/data-models/mcp-tool-call-log-repo.ts`

`packages/database` should expose the Prisma client, generated types, transactions, seeds, migrations, and shared DB utilities. It should not become a catch-all business logic or repository package.

## Repository Pattern

All database table access should go through the owning model repository or a domain service that calls that repository.

Every non-Better Auth app-owned table should have a repository file in its owning package. Repositories are the place to generate prefixed IDs, enforce tenant scoping, normalize write data, and keep Prisma access out of apps.

Prefer focused functions over generic base repositories:

```ts
export async function getContactById(...)
export async function listContactsForOrganization(...)
export async function createContact(...)
export async function updateContact(...)
export async function archiveContact(...)
```

Avoid generic abstractions like `BaseRepository<T>` unless the codebase already has a proven local pattern for it.

Any model with an `orgId` property should typically include `orgId` passed into the repo method.
For example:

```ts
getAllContactsForOrg(orgId);
updateContact(contactId, orgId, dataToUpdate);
getContactById(contactId, orgId);
```

Keeping these to organization scope should help prevent accidental data leakage, as we should require orgId at the authorization layer (typically in nextJS actions or at http handlers)

## Better Auth Tables

Better Auth owns many auth tables through its adapter and APIs. Prefer Better Auth APIs for operations Better Auth owns, such as sessions, account linking, verifications, OAuth tokens, OAuth consents, API keys, invitations, member role changes, and lifecycle flows.

Only create repos for Better Auth-backed tables when the app intentionally exposes them as product-facing domain concepts, such as:

- `packages/auth/src/data-models/user-repo.ts`
- `packages/auth/src/data-models/organization-repo.ts`
- `packages/auth/src/data-models/member-repo.ts`

Avoid direct app CRUD repos for internal mechanism tables like `session`, `account`, `verification`, OAuth access tokens, OAuth refresh tokens, OAuth consents, API keys, or `twoFactor` unless there is a specific product requirement and Better Auth's API cannot cover it. Do not create repository functions that bypass Better Auth token handling, expiry logic, revocation semantics, hooks, or plugin assumptions.

If an auth package has a `src/data-models/` folder, add or keep a local README explaining why Better Auth internal tables are not wrapped by default and when an auth table is allowed to get a repository.

## ID Generation

App-owned tables should use prefixed string IDs generated in TypeScript through `@workspace/common/create-id`. Keep ID prefixes grouped by database domain and expose one aggregate `IdPrefix` type.

Recommended shape:

```ts
export type AuthIdPrefix = "user" | "org" | "mbr";
export type ContactsIdPrefix = "contact" | "company" | "staddr";
export type BillingIdPrefix = "sub" | "price" | "inv";
export type McpIdPrefix = "mcptcl";

export type IdPrefix =
  | AuthIdPrefix
  | ContactsIdPrefix
  | BillingIdPrefix
  | McpIdPrefix
  | "tmp";
```

Repositories should set IDs explicitly when creating app-owned records:

```ts
await prisma.contact.create({
  data: {
    id: createId("contact"),
    // ...
  },
});
```

For Better Auth-created records, use Better Auth's `advanced.database.generateId` option when prefixed IDs are required. Keep Better Auth's model-to-prefix mapping in `packages/auth` rather than in `packages/common`, because that mapping is auth-package behavior. Prisma defaults cannot call the TypeScript `createId()` helper directly.

## Implementation Checklist

When adding a model:

1. Add or update the Prisma model in the correct centralized schema file.
2. Add indexes, unique constraints, and relations needed by actual access patterns.
3. Add the domain-owned repo in `packages/<domain>/src/data-models/<database-table-name>-repo.ts` unless it is a Better Auth internal table that should be accessed through Better Auth APIs.
4. Generate prefixed IDs in the repository for app-owned records when the model uses string IDs.
5. Keep organization scoping explicit for tenant-owned data.
6. Export repo functions through the package's public API if other packages/apps need them.
7. Add seed data only when the model is part of the default starter experience.
8. Add tests for repository behavior, especially organization scoping and unique constraints.
9. When changing these conventions, update AI guidance in `.ai/`, `.claude/`, and `.cursor/` according to `.ai/conventions/ai-guidance-files.md`.
10. Run the relevant verification commands before claiming completion.

## Boundary Rules

- `packages/database`: Prisma schema, generated client, migrations, seeds, transactions, shared DB utilities.
- `packages/auth`: Better Auth config, permissions, guards, session helpers, auth-owned repos.
- `packages/contacts`: contacts, companies, addresses, contacts-owned repos and services.
- `packages/billing`: subscriptions, products, invoices, payment-provider integrations, billing-owned repos and services.
- `packages/domain`: anything else that does not fit in other schema files, such as domain-specific tables for the apps.
- `apps/*`: UI, routes, server actions, and app composition. Apps call domain package APIs rather than Prisma directly.

## Naming

Use lowercase kebab-case filenames:

- `contact-repo.ts`
- `street-address-repo.ts`
- `subscription-repo.ts`
- `member-repo.ts`

Use clear exported function names:

- `get<Model>ById`
- `list<Models>ForOrg`
- `create<Model>`
- `update<Model>`
- `archive<Model>` or `delete<Model>` depending on the domain deletion policy
