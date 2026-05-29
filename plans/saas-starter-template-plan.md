# SaaS Starter Template Plan

> **Status (2026-05-29):** Sections referencing pgmq + pg_cron are superseded by [`docs/superpowers/specs/2026-05-28-deploy-profiles-design.md`](../docs/superpowers/specs/2026-05-28-deploy-profiles-design.md). The runtime queue is now BullMQ + Redis (local/PaaS) or cloud-native (GCP/AWS/Azure).

This is a starter template that was built using the superpowers agentic skill framework
https://github.com/obra/superpowers

## Executive Summary

This SaaS starter template will provide a complete foundation for building modern web applications with:

- **Monorepo Architecture**: TurboRepo with apps and shared packages
- **Full-Stack TypeScript**: Next.js 16, React 19, Prisma 7, Better Auth
- **Production-Ready Features**: Authentication, billing, webhooks, notifications
- **Enterprise Patterns**: Multi-tenancy, role-based permissions, audit trails
- **Developer Experience**: Comprehensive tooling, testing, and deployment
- **Agentic coding support**: various skills, hooks and instruction files for ai development with popular tools like Claude Code, Cursor, and more.

## Core Technology Stack

### Frontend

- **Next.js 16** with App Router
- **React 19** with Server Components
- **TypeScript 5.7+** for type safety
- **Tailwind CSS 3.4+** for styling
- **Shadcn/ui** component library (Radix UI + Tailwind)
- **Lucide React** for icons
- **React Hook Form** with Zod validation
- **Tanstack Table** for data grids

### Backend

- **Prisma** ORM with PostgreSQL
- **Better Auth** for authentication, sessions, organizations, invitations, and system admin roles
- **Next.js API Routes** and Server Actions
- **Stripe** for billing and payments
- **Resend/NodeMailer** for email
- **Zod** for schema validation
- **Server-only** directive for secure server code
- **pgmq** (Postgres Message Queue) for durable background job processing
- **pg_cron** for scheduled job triggers

### Infrastructure & Tooling

- **TurboRepo** for monorepo management
- **pnpm** package manager
- **ESLint + Prettier** for code quality and ecosystem compatibility
- **Vitest + Testing Library** for fast unit and component tests
- **Playwright** for critical end-to-end flows
- **TypeScript strict mode** with reasonable defaults
- **Sentry** for error monitoring and performance traces
- **PostHog** for product analytics, feature flags, and session replay
- **Docker Compose** for local Postgres, Redis, and integration test dependencies

## Architecture Overview

Detailed authentication implementation guidance lives in [`plans/01-add-auth.md`](./01-add-auth.md), including Better Auth configuration, organization/admin role choices, Better Auth UI usage, and package/app ownership boundaries.

### Monorepo Structure

```
/
├── apps/              # These can be deployed to servers
│   ├── dashboard/     # Main SaaS application
│   ├── workers/       # Event consumer process — polls pgmq and dispatches to typed handlers
│   ├── public-api/    # Public API for 3rd party integrations
│   ├── public-mcp/    # For 3rd party AI integrations
│   ├── www/           # For Marketing site
│   ├── prisma-studio/  # database GUI wrapper
│   ├── react-email-preview/    # email template preview via React Email
│   ├── stripe-webhook-listener/    # local Stripe webhook listener script package
│   ├── webhook-listener/  # webhook development utilities
│   ├── webhook-tester/    # webhook testing utilities
│   ├── database-migrator/  # migration helper app
│   ├── requirements-check/ # install-time environment/tooling checks
│
├── packages/          # Shared packages
│   ├── auth/          # Authentication, permissions, and auth-owned model repos in src/models/
│   ├── database/      # Centralized Prisma schema/client, migrations, seeding, and DB utilities
│   ├── worker-queue/  # Event type registry, enqueue() client, queue adapter (pgmq default, swappable)
│   ├── ui/            # Shared UI components across any ui package or ui based app with shadcn components
│   ├── email/         # Email templates & sending via React email and helper
│   ├── monitoring/    # Error tracking & analytics
│   ├── common/        # Shared utilities
│   ├── crm/           # CRM domain logic and CRM-owned model repos in src/models/
│   ├── billing/       # Stripe/Square billing and payment logic with billing-owned model repos in src/models/

├── tooling/           # Single @workspace/tooling package — shared dev configs
│   ├── eslint/        # ESLint configs (base, react, nextjs)
│   ├── prettier/      # Prettier config
│   ├── tailwind/      # Tailwind config + tokens
│   └── typescript/    # tsconfig presets (base, nextjs, react-library)
└── docs/                         # Documentation
```

### Feature-Based Organization

Each business feature follows this structure:

```
apps/dashboard/features/[feature-name]/
├── ui/                   # UI components
│   ├── [feature]-page-content.tsx
│   ├── [feature]-data-table.tsx
│   ├── add-[feature]-button-modal.tsx
│   └── edit-[feature]-button-modal.tsx
├── data/                        # Server-side logic
│   ├── [feature]-repo.ts       # Database operations
│   ├── [feature]-actions.ts    # Server actions
│   └── [feature]-types.ts      # Zod schemas & types
```

### Background Processing Architecture

Events are the universal abstraction for all background work. Cron schedules, app code, and external webhooks all produce events that flow through a single pipeline.

**Queue: pgmq (Postgres Message Queue)**

pgmq is a Postgres extension providing durable message queues with at-least-once delivery, FIFO support, message archival, and zero additional infrastructure (runs inside the existing PostgreSQL database). Handlers must be idempotent. It is a first-party Supabase integration, works through connection poolers, and is visible in the Supabase dashboard. **Design spec:** [`docs/superpowers/specs/2026-05-22-worker-queue-pgmq-design.md`](../docs/superpowers/specs/2026-05-22-worker-queue-pgmq-design.md).

**Scheduling: pg_cron**

pg_cron triggers scheduled events by publishing messages into pgmq on a timer. Cron schedules are declared as **SQL migrations only** (single source of truth — no duplicate TypeScript scheduler). pg_cron does not execute job logic directly — it only publishes events into the queue.

**Local development:** Docker Compose uses a Postgres 16 image with `pgmq` and `pg_cron` (`docker/postgres`). **Production:** Supabase is the reference deploy path; any Postgres with both extensions is supported (BYO). **Workers:** `apps/workers` ships as a host-agnostic Docker image (no Fly/Railway/k8s manifests in the template).

**Architecture Layers**

```
┌─────────────────────────────────────────────────────────┐
│  Trigger Sources                                         │
│                                                          │
│  Server Action          pg_cron Schedule   Stripe Webhook │
│  (app code)             (timer → pgmq)     (HTTP)         │
│       │                      │                  │         │
│       ▼                      ▼                  ▼         │
│  ┌──────────────────────────────────────────────────┐    │
│  │         enqueue(eventName, payload)               │    │
│  │           packages/worker-queue/client             │    │
│  └──────────────────────┬───────────────────────────┘    │
│                         │                                 │
│                         ▼                                 │
│  ┌──────────────────────────────────────────────────┐    │
│  │              pgmq queue (in Postgres)              │    │
│  │  at-least-once · visibility timeout · archival     │    │
│  └──────────────────────┬───────────────────────────┘    │
│                         │                                 │
│                         ▼                                 │
│  ┌──────────────────────────────────────────────────┐    │
│  │         apps/workers (consumer process)            │    │
│  │  Polls pgmq → validates → dispatches to handler   │    │
│  │  Acks on success · nacks on failure · retries      │    │
│  └──────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

**`packages/worker-queue`** — Shared package importable by any app that needs to publish events:

- `events.ts` — Zod-validated event type registry (e.g. `user.welcome-email`, `cleanup.expired-sessions`, `webhook.deliver`)
- `client.ts` — `enqueue()` function used by app code to fire-and-forget background work
- `types.ts` — `QueueAdapter` interface (`publish` for producers; consumer receive/ack/nack in workers)
- `adapters/pgmq.ts` — Default adapter using pgmq SQL functions, includes retry/backoff/dead-letter logic
- `adapters/sync.ts` — Test/dev adapter (enqueue runs inline or logs; no extensions required)
- Alternative adapters (BullMQ, SQS) can be swapped via `WORKER_QUEUE_ADAPTER` without changing handler code

**`apps/workers`** — Single deployable process that consumes and processes events:

- `handlers/` — TypeScript handler functions (one per event type)
- `registry.ts` — Maps event names to handler functions
- `Dockerfile` — Host-agnostic container image for any orchestrator
- Consumer loop that polls pgmq, validates payloads, and dispatches to handlers
- Runs as a long-lived Node.js process (no serverless timeout constraints)
- Isolates background processing resources from user-facing request latency
- Exposes an HTTP health check endpoint for monitoring

**Cron schedules as SQL migrations:**

```sql
-- Publish to pgmq on schedule (pg_cron is just the timer)
SELECT cron.schedule(
  'cleanup-expired-sessions',
  '0 3 * * *',
  $$SELECT pgmq.send('jobs', '{"event":"cleanup.expired-sessions"}')$$
);
```

**App code enqueuing after business logic:**

```typescript
// In a server action — fire-and-forget
const user = await createUser(organization.id, data);
await enqueue("user.welcome-email", {
  userId: user.id,
  orgId: organization.id,
});
```

**Event publishing pattern** remains unchanged: business logic packages return data, the app layer calls `enqueue()` or `publishSystemEvent()` which delegates to the queue internally.

## Core Features & Functionality

### 1. Authentication & Authorization

**Multi-Provider Authentication**

- Email/password with secure hashing
- Google OAuth integration
- Microsoft Entra ID (Azure AD)
- Two-factor authentication (TOTP)
- Password reset flows
- Email verification

**Role-Based Access Control**

- Better Auth organization plugin as the source of truth for organizations, members, invitations, and organization-scoped roles
- Default organization roles: `owner`, `admin`, and `member`
- Static code-defined permission map for starter resources, using Better Auth access control (`resource.action` format)
- Keep organization roles simple by default; do not enable dynamic organization roles or teams in the initial template
- Better Auth admin plugin for system-level roles and platform administration
- Default system roles: `user` and `admin`
- System admin capabilities include user management, session revocation, banning/unbanning, and impersonation
- Permission checks for server actions, API routes, and dashboard navigation
- Better Auth schema tables/fields: `organization`, `member`, `invitation`, `session.activeOrganizationId`, `user.role`, `user.banned`, `session.impersonatedBy`

**Session Management**

- Secure session handling via Better Auth
- Automatic session refresh
- Device-based session tracking
- Session invalidation

### 2. Multi-Tenant Architecture

**Organization Management**

- Organization creation and setup via Better Auth organization plugin
- Custom organization slugs
- Organization settings and branding
- Member invitations and management via Better Auth invitation/member APIs
- Organization-scoped data isolation

**Data Isolation**

- Row-level security via organization filtering
- Prisma middleware for automatic scoping
- API key scoping to organizations
- Audit trails per organization

### 3. Subscription & Billing

**Stripe Integration**

- Subscription management
- Multiple pricing tiers
- Usage-based billing
- Payment method management
- Invoice generation
- Billing portal integration
- Webhook handling for payment events

**Billing Features**

- Free tier with limitations
- Pro/Enterprise tiers
- Annual/monthly billing cycles
- Proration handling
- Failed payment recovery
- Dunning management

### 4. User Management

**User Profiles**

- Profile management
- Avatar uploads
- Preference settings
- Notification preferences
- Account security settings

**Team Collaboration**

- Team member invitations
- Role assignment
- Activity tracking
- User onboarding flows

### 5. System Events & Notifications

**Event System** (powered by pgmq + pg_cron)

- Centralized event publishing via `enqueue()` into pgmq
- Typed event payloads with Zod validation in `packages/worker-queue`
- Webhook delivery to external systems (enqueued as background jobs)
- Email notifications to users (enqueued as background jobs)
- Scheduled triggers via pg_cron publishing events into pgmq
- Retry with exponential backoff and dead-letter handling in the queue adapter
- Event metadata and filtering

**Notification Management**

- User notification preferences
- Email templates with React Email
- In-app notifications
- Notification history
- Unsubscribe handling

### 6. API Infrastructure

**Public API**

- RESTful API design
- API key authentication
- Rate limiting
- Request/response logging
- OpenAPI documentation
- SDK generation

**Webhook System**

- Outbound webhook delivery
- Signature verification
- Retry logic with exponential backoff
- Webhook endpoint management
- Event filtering

### 7. Data Management

**Database Design**

- Multi-tenant data model
- Soft deletion patterns
- Optimistic locking
- Database migrations
- Seeding scripts

**File Storage**

- S3-compatible storage
- Image processing
- File upload handling
- CDN integration
- Access control

### 8. Monitoring & Observability

**Error Tracking**

- Sentry integration
- Error boundaries
- Performance monitoring
- User feedback collection

**Analytics**

- User behavior tracking
- Feature usage metrics
- Performance monitoring
- Business intelligence

## UI/UX Design System

### Design Principles

1. **Simplicity First**: Clear visual hierarchy, progressive disclosure
2. **Consistency**: Reusable patterns and components
3. **Accessibility**: WCAG 2.1 AA compliance, keyboard navigation
4. **Responsiveness**: Mobile-first design approach
5. **Performance**: Optimized loading and interactions

### Component Library

**Base Components** (from Shadcn/ui)

- Button, Input, Label, Textarea
- Select, Checkbox, Radio, Switch
- Dialog, Popover, Tooltip, Sheet
- Table, Pagination, Tabs
- Form, Card, Badge, Avatar

**Composite Components**

- DataTable with sorting, filtering, pagination
- FormBuilder with validation
- FileUploader with progress
- NotificationToast system
- EmptyState illustrations

### Responsive Design

- Mobile-first approach
- Breakpoint system (sm, md, lg, xl)
- Adaptive layouts
- Touch-friendly interactions
- Progressive enhancement

## Development Experience

### Code Quality

**Linting & Formatting**

- ESLint with strict rules
- Prettier for consistent formatting
- TypeScript strict mode
- Import organization
- Commit hooks for quality gates

**Testing Strategy**

- Unit tests with ViTest (Jest compatible)
- Integration tests with Testing Library
- E2E tests with Playwright
- Visual regression testing
- API testing

**Type Safety**

- End-to-end TypeScript
- Zod schema validation
- Prisma generated types
- API contract validation
- Runtime type checking

### Developer Tooling

**Development Environment**

- Hot reloading
- Error boundaries with stack traces
- Database GUI (Prisma Studio)
- Email preview server
- Webhook testing tools

**Build & Deploy**

- TurboRepo caching
- Incremental builds
- Environment-specific configs
- Docker containerization
- CI/CD pipeline templates

## Security Features

### Application Security

**Input Validation**

- Zod schema validation
- SQL injection prevention
- XSS protection
- CSRF tokens
- Rate limiting

**Authentication Security**

- Secure password hashing (bcrypt)
- Session management
- JWT token handling
- Two-factor authentication
- Account lockout policies

**Data Protection**

- Encryption at rest
- Encryption in transit
- PII handling
- GDPR compliance utilities
- Data retention policies

### Infrastructure Security

**API Security**

- API key management
- Request signing
- Rate limiting
- IP whitelisting
- Audit logging

**Environment Security**

- Environment variable management
- Secrets rotation
- Security headers
- HTTPS enforcement
- Content Security Policy

## Deployment & Operations

### Deployment Options

**Vercel (Recommended)**

- Zero-config deployment
- Automatic scaling
- Edge functions
- Preview deployments
- Analytics integration

**Self-Hosted**

- Docker containers
- Kubernetes manifests
- Database migrations
- Environment management
- Load balancing

### Monitoring & Maintenance

**Health Checks**

- Application health endpoints
- Database connectivity
- External service status
- Performance metrics
- Uptime monitoring

**Maintenance Tasks**

- Database cleanup jobs (scheduled via pg_cron → pgmq → worker handler)
- pgmq message archival cleanup
- pg_cron `job_run_details` table maintenance
- Log rotation
- Cache invalidation
- Security updates
- Backup procedures

## Implementation Roadmap

### Phase 1.1: Core Foundation (Weeks 1-4)

- [ ] Set up monorepo structure with TurboRepo. only include `apps/dashboard`, `apps/www` and whatever packages are required such as `tooling` and `packages/common` for this phase.
- [ ] Configure TypeScript, ESLint, Prettier
- [ ] Implement basic Next.js apps (dashboard, www). Follow `.ai/skills/add-new-page/SKILL.md` when creating pages, routes, feature folders, and navigation entries.

### Phase 1.2: Styling and components → [detailed plan](./01-add-styles.md)

- [ ] Establish CSS styling with tailwind and a central place to manage colors, default styles, custom classes, etc.
- [ ] Create basic UI component library with shadcn
- [ ] Set up navigation side bar menus in dashboard (org specific, root, org settings)

### Phase 1.3: Database and auth basics

- [ ] Set up Prisma with Better Auth core, organization, and admin plugin schema
- [ ] Implement Better Auth with email/password and system admin roles
- [ ] Create basic UI component library (shadcn, look at the `01-add-auth.md` plan)

### Phase 1.3

- [ ] Set up development environment
- [ ] Enable pgmq and pg_cron extensions in database
- [ ] Create `packages/worker-queue` with event type registry, pgmq adapter, and `enqueue()` client
- [ ] Create `apps/workers` consumer process with health check endpoint

### Phase 2: Authentication & Multi-tenancy (Weeks 5-8)

- [ ] Implement OAuth providers (Google, Microsoft)
- [ ] Add optional two-factor authentication
- [ ] Build organization management with Better Auth organization plugin
- [ ] Implement organization-scoped permissions with Better Auth access control
- [ ] Create user invitation system with Better Auth invitation APIs
- [ ] Add organization-scoped data filtering
- [ ] Build user onboarding flows

### Phase 3: Billing & Subscriptions (Weeks 9-12)

- [ ] Integrate Stripe for subscriptions
- [ ] Implement pricing tiers
- [ ] Build billing portal
- [ ] Add usage tracking
- [ ] Create invoice generation
- [ ] Handle webhook events
- [ ] Add payment failure recovery

### Phase 4: API & Webhooks (Weeks 13-16)

- [ ] Build public API infrastructure
- [ ] Implement API key management
- [ ] Add rate limiting
- [ ] Create webhook system
- [ ] Build OpenAPI documentation
- [ ] Add request/response logging
- [ ] Implement retry mechanisms

### Phase 5: Notifications & Events (Weeks 17-20)

- [ ] Build system event publishing via `enqueue()` into pgmq
- [ ] Create email templates (React Email)
- [ ] Add email notification handler in `apps/workers`
- [ ] Implement notification preferences
- [ ] Add in-app notifications
- [ ] Build webhook delivery handler with retry/backoff in `apps/workers`
- [ ] Add pg_cron schedules as SQL migrations for recurring jobs
- [ ] Create notification history
- [ ] Add unsubscribe handling

### Phase 6: Advanced Features (Weeks 21-24)

- [ ] Add file upload/storage
- [ ] Implement audit trails
- [ ] Build admin panel
- [ ] Add monitoring/analytics
- [ ] Create backup/restore
- [ ] Implement data export
- [ ] Add advanced security features

### Phase 7: Documentation & Polish (Weeks 25-28)

- [ ] Write comprehensive documentation
- [ ] Create deployment guides
- [ ] Build example implementations
- [ ] Add migration tools
- [ ] Create video tutorials
- [ ] Polish UI/UX
- [ ] Performance optimization

## Success Metrics

### Developer Experience

- Time to first deployment: < 30 minutes
- Feature development velocity: 2x faster than from scratch
- Code quality: 90%+ test coverage
- Documentation completeness: 100% API coverage

### Application Performance

- Page load times: < 2 seconds
- API response times: < 200ms
- Uptime: 99.9%
- Error rates: < 0.1%

### Business Features

- Multi-tenant isolation: 100% secure
- Payment processing: 99.9% success rate
- Notification delivery: 99% success rate
- API reliability: 99.9% uptime

## Key Architectural Patterns

### Package Dependency Guidelines

Keep shared packages **pure and focused**. Avoid polluting packages with unnecessary dependencies:

| Package                   | Should NOT depend on      | Reason                                        |
| ------------------------- | ------------------------- | --------------------------------------------- |
| `@workspace/database`     | `@workspace/worker-queue` | Database is foundational; avoid circular deps |
| `@workspace/billing`      | `@workspace/worker-queue` | Billing returns data; callers enqueue events  |
| `@workspace/worker-queue` | `@workspace/email`        | Queue package is transport-only; no JSX deps  |

**Event Publishing Pattern**: Business logic packages (billing, database) should return data. The app layer (dashboard actions, webhook routes) enqueues events for background processing:

```typescript
// In billing package - returns data, doesn't enqueue
const { subscription, orgId } = await createSubscription(...);

// In dashboard action / webhook route - enqueues for async processing
await enqueue("subscription.created", { subscriptionId: subscription.id, orgId });
```

### Feature Organization Principles

**Shared Packages vs Feature Folders**

| Code Type                                               | Location                             | Example                                                        |
| ------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------- |
| Stripe/billing logic (types, pure functions, SDK calls) | `packages/billing/src/`              | `stripe-payment-intent.ts`, `stripe-client.ts`                 |
| Billing model repositories                              | `packages/billing/src/models/`       | `subscription-repo.ts`, `product-repo.ts`                      |
| CRM model repositories                                  | `packages/crm/src/models/`           | `contact-repo.ts`, `address-repo.ts`                           |
| Auth logic & permissions                                | `packages/auth/src/`                 | `permissions.ts`, `guards.ts`                                  |
| Auth model repositories                                 | `packages/auth/src/models/`          | `member-repo.ts`, `organization-repo.ts`                       |
| Centralized Prisma schema/client/migrations             | `packages/database/`                 | `prisma/auth.prisma`, `src/client.ts`                          |
| Stripe UI components & Next.js server actions           | `apps/dashboard/features/stripe/`    | `stripe-connect-button-modal.tsx`, `stripe-connect-actions.ts` |
| Business feature UI & actions                           | `apps/dashboard/features/[feature]/` | `feature-repo.ts`, `add-feature-modal.tsx`                     |

See [`plans/01-add-auth.md`](./01-add-auth.md) for the full Better Auth package/app breakdown.

**Rule of thumb**: If code could be reused across multiple apps or is core infrastructure, it belongs in `packages/`. If it's dashboard-specific UI components or Next.js server actions, it belongs in `features/`.

### Data Management Patterns

**Prisma Schema Organization**

- Keep Prisma schema centralized in `packages/database/prisma/`, but split it into a small number of coarse domain files
- `base.prisma`: Prisma generator, datasource, and shared enums
- `auth.prisma`: Everything Better Auth gives us, including core auth, organization, admin, and optional 2FA schema
- `crm.prisma`: CRM-style reusable models such as contacts, companies, street addresses, and related records
- `billing.prisma`: Stripe subscriptions, products, prices, invoices, app billing state, and payment-provider integration records such as Stripe and Square

**Repository Organization**

- Use the repository pattern for database table access: database reads/writes should go through a `modelname-repo.ts` file
- Keep repositories domain-owned rather than centralized in `packages/database`
- Put repos under each package's `src/models/` folder, such as `packages/crm/src/models/contact-repo.ts`, `packages/crm/src/models/address-repo.ts`, `packages/billing/src/models/subscription-repo.ts`, and `packages/auth/src/models/member-repo.ts`
- `packages/database` should expose the Prisma client, generated types, transactions, migrations, seeds, and shared DB utilities; it should not become a catch-all business logic package
- Apps should call domain package APIs/repositories instead of importing Prisma directly

**Type Safety with Decimal Types**

- Build `to{ModelName}Dto()` and `from{ModelName}Dto()` functions for Decimal types
- Actions call `toDto()` before returning
- Client code calls `fromDto()` after receiving data

### Permission System

Use Better Auth access control as the default permission engine.

- Define starter-template permissions in `packages/auth/src/permissions.ts` as `resource.action` statements
- Use static organization roles (`owner`, `admin`, `member`) for the initial template
- Use Better Auth admin plugin roles (`user`, `admin`) for platform/system-level access
- Wrap Better Auth permission checks in app helpers such as `getCurrentUserAndOrg('permission.id')` for server actions
- Get current organization: `useActiveOrganization()` (client-side hook)

### Routing Patterns

- Sparse `page.tsx` files in app directory for routing only
- Page content components in `[feature]-page-content.tsx` within feature folders
- Use helper functions from `packages/routes/src/index.ts` for URL generation
- Update `nav-items.tsx` for navigation changes

## Competitive Advantages

1. **Production-Ready**: Based on real SaaS application patterns
2. **Comprehensive**: Includes all essential SaaS features out-of-the-box
3. **Type-Safe**: End-to-end TypeScript with runtime validation
4. **Scalable**: Monorepo architecture supports growth
5. **Accessible**: WCAG 2.1 AA compliant design system
6. **Developer-Friendly**: Excellent DX with modern tooling
7. **Customizable**: Modular architecture allows easy customization
8. **Well-Documented**: Comprehensive guides and examples
9. **Enterprise-Grade**: Multi-tenancy, audit trails, role-based permissions
10. **Battle-Tested**: Patterns proven in production environment

## Business Domain Examples

The template will include example implementations for common SaaS domains:

### CRM Features

- Contact management with activities, notes, tasks
- Lead scoring and pipeline management
- Communication history tracking
- Custom fields and tags

### E-commerce Features

- Product catalog with variants and pricing
- Order management with line items and payments
- Inventory tracking and reservations
- Invoice generation and billing

### Project Management Features

- Project creation and organization
- Task management with stages and assignments
- Schedule planning and timeline views
- Team collaboration tools

### Content Management

- File upload and storage with S3 integration
- Image processing and optimization
- Gallery management with metadata
- Access control and sharing

## Conclusion

This SaaS starter template will provide developers with a robust foundation for building modern web applications. By incorporating proven patterns from other codebases and following industry best practices, it will significantly reduce development time while ensuring scalability, security, and maintainability.

The template will serve as both a starting point for new projects and a reference implementation for SaaS application architecture, making it valuable for developers at all levels. The comprehensive feature set, combined with excellent developer experience and production-ready patterns, positions this template as a premium offering in the SaaS starter space.

## Next Steps

1. **Repository Setup**: Create new repository with clean git history
2. **Code Extraction**: Extract and generalize patterns from other codebases
3. **Documentation**: Create comprehensive setup and usage guides
4. **Examples**: Build sample implementations for different domains
5. **Testing**: Ensure all features work in isolation
6. **Community**: Open source with clear contribution guidelines
7. **Support**: Provide migration tools and upgrade paths
