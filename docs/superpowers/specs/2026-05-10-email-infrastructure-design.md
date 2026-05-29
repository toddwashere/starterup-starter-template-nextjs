# Email Infrastructure Design

Add transactional email support using React Email for templates, Resend as the default sending provider, and a provider abstraction layer that makes swapping providers straightforward.

## Decisions

- **Sending API**: Per-email sender functions (e.g. `sendWelcomeEmail({ recipient, name })`) that handle rendering and delivery in one call. Callers import a single function and pass typed props.
- **Architecture**: Provider abstraction (Approach B). A typed `EmailProvider` interface with Resend as the default implementation. Swapping to SendGrid/Postmark/SES means writing a new provider and changing one re-export.
- **Templates**: React Email components styled with `@react-email/tailwind`. Shared `EmailLayout` component extracts the boilerplate.
- **Preview**: A dedicated `apps/email-preview` app using the React Email CLI dev server.
- **Rendering**: `@react-email/render` produces both HTML and plain text. Templates are rendered server-side before passing to the provider (keeps the provider interface transport-agnostic).

## Scope

### In scope

- `packages/email` shared package (provider, templates, sender functions, env validation)
- `apps/email-preview` React Email CLI dev server
- Replace 3 console.log stubs in `packages/auth/src/auth.ts` with real sender calls
- 5 email templates: welcome-and-verify, welcome, email-change-verification, password-reset, invitation
- Environment variables (`RESEND_API_KEY`, `EMAIL_FROM`) added to `.env.example`
- Graceful degradation when `RESEND_API_KEY` is missing (log to console, don't throw)
- Automated tests (see Testing section)

### Out of scope

- Additional email providers beyond Resend (the interface supports them; implementations are future work)
- Email template snapshot tests (add after templates stabilize)
- E2E delivery tests with Resend test addresses
- In-app notification system
- Notification preferences / unsubscribe handling

> **Update:** Worker queue integration is now implemented — signup enqueues `user.welcome-email` and `apps/workers` calls these senders from job handlers. See [`2026-05-22-worker-queue-pgmq-design.md`](./done/2026-05-22-worker-queue-pgmq-design.md) and the [deploy guide](./done/2026-05-22-worker-queue-pgmq-deploy.md).

## Package: `packages/email`

### Directory structure

```
packages/email/
├── package.json                                  # @workspace/email
├── keys.ts                                       # env validation via Zod
├── tsconfig.json                                 # extends @workspace/tooling typescript
├── eslint.config.mjs
├── src/
│   ├── index.ts                                  # barrel export
│   ├── render.ts                                 # renderEmail(component) → { html, text }
│   ├── provider/
│   │   ├── types.ts                              # EmailProvider interface, EmailPayload type
│   │   ├── resend/
│   │   │   ├── index.ts                          # Resend implementation
│   │   │   └── resend-options.ts                 # default from address, config
│   │   └── index.ts                              # re-exports active provider
│   ├── templates/
│   │   ├── _components/
│   │   │   └── email-layout.tsx                  # shared Html/Head/Preview/Tailwind/Body/Container wrapper
│   │   ├── welcome-and-verify-email.tsx
│   │   ├── welcome-email.tsx
│   │   ├── email-change-verification-email.tsx
│   │   ├── password-reset-email.tsx
│   │   └── invitation-email.tsx
│   ├── send-welcome-and-verify-email.ts
│   ├── send-welcome-email.ts
│   ├── send-email-change-verification-email.ts
│   ├── send-password-reset-email.ts
│   └── send-invitation-email.ts
├── __tests__/
│   ├── template-render.test.ts                   # smoke tests for all 5 templates
│   ├── sender-functions.test.ts                  # mocked provider, verify wiring
│   ├── auth-hook-routing.test.ts                 # emailVerified routing logic
│   ├── graceful-degradation.test.ts              # no API key → log, don't throw
│   └── resend-provider.test.ts                   # error handling
```

### Dependencies

- `resend` (v6.x) — Resend Node.js SDK
- `@react-email/components` (v1.x) — React Email component library
- `@react-email/render` (latest) — server-side render to HTML and plain text
- `@react-email/tailwind` (latest) — Tailwind CSS support in email templates
- `react` (v19.x) — peer dependency for JSX rendering
- `zod` — env validation in `keys.ts`

### `keys.ts` — Environment validation

Validates two env vars using Zod:

- `RESEND_API_KEY`: `string`, optional. When missing, sender functions fall back to console logging.
- `EMAIL_FROM`: `string`, optional, defaults to `"App <noreply@example.com>"`. The sender address for all outgoing emails.

The keys function returns validated values. Sender functions check for `RESEND_API_KEY` before calling the provider.

### Provider abstraction

**`src/provider/types.ts`**

```typescript
export interface EmailPayload {
  recipient: string | string[];
  subject: string;
  html: string;
  text: string;
  cc?: string | string[];
  replyTo?: string | string[];
  tags?: Array<{ name: string; value: string }>;
}

export interface EmailProvider {
  sendEmail(payload: EmailPayload): Promise<{ id?: string }>;
}
```

**`src/provider/resend/index.ts`**

- Creates a `Resend` instance using `keys().RESEND_API_KEY`
- Maps `EmailPayload` to Resend's `CreateEmailOptions`
- Uses the `{ data, error }` return pattern from the Resend SDK (does not use try/catch for SDK responses)
- Throws a meaningful error when `response.error` is present
- Gets the `from` address from `resend-options.ts` which reads `keys().EMAIL_FROM`

**`src/provider/index.ts`**

Re-exports the active provider. To swap providers, change this one file:

```typescript
export { default as EmailProvider } from "./resend";
```

### Render helper

**`src/render.ts`**

```typescript
import { render } from "@react-email/render";

export async function renderEmail(
  component: React.ReactElement
): Promise<{ html: string; text: string }> {
  const html = await render(component);
  const text = await render(component, { plainText: true });
  return { html, text };
}
```

Used by every sender function to produce HTML and plain text from a React Email template.

### Sender functions

Each sender function follows the same pattern:

1. Check if `RESEND_API_KEY` is configured — if not, log the email details and return early
2. Call the template component with typed props to get a React element
3. Pass the element to `renderEmail()` to get `{ html, text }`
4. Call `EmailProvider.sendEmail()` with recipient, subject, html, text

Example (`send-welcome-and-verify-email.ts`):

```typescript
import { renderEmail } from "./render";
import { EmailProvider } from "./provider";
import { keys } from "../keys";
import { WelcomeAndVerifyEmail } from "./templates/welcome-and-verify-email";

export interface SendWelcomeAndVerifyEmailInput {
  recipient: string;
  name: string;
  verifyUrl: string;
}

export async function sendWelcomeAndVerifyEmail(
  input: SendWelcomeAndVerifyEmailInput
): Promise<void> {
  const { RESEND_API_KEY } = keys();
  if (!RESEND_API_KEY) {
    console.log(`[Email] Welcome & verify email for ${input.recipient}: ${input.verifyUrl}`);
    return;
  }

  const component = WelcomeAndVerifyEmail({
    name: input.name,
    verifyUrl: input.verifyUrl,
  });
  const { html, text } = await renderEmail(component);

  await EmailProvider.sendEmail({
    recipient: input.recipient,
    subject: "Welcome! Please verify your email",
    html,
    text,
  });
}
```

All five sender functions follow this same structure with template-specific props and subjects.

### Templates

All templates use `@react-email/components` and `@react-email/tailwind` for styling. They share a common `EmailLayout` component.

**`src/templates/_components/email-layout.tsx`**

Wraps every template with the standard structure: `Html` → `Head` → `Preview` → `Tailwind` → `Body` → `Container`. The container uses a clean, minimal style: white background, light gray border (`#eaeaea`), max-width 465px, sans-serif font. The `_components/` prefix ensures React Email's preview server ignores this directory.

Props: `preview` (string for the email preview text), `children` (template content).

**Template props and content:**

| Template | Props | Subject | CTA |
|----------|-------|---------|-----|
| `welcome-and-verify-email` | `name: string`, `verifyUrl: string` | "Welcome! Please verify your email" | "Verify & Get Started" → `verifyUrl` |
| `welcome-email` | `name: string`, `getStartedUrl: string` | "Welcome!" | "Get Started" → `getStartedUrl` |
| `email-change-verification-email` | `name: string`, `verifyUrl: string` | "Confirm your new email address" | "Confirm New Email" → `verifyUrl` |
| `password-reset-email` | `name: string`, `resetUrl: string` | "Reset your password" | "Reset Password" → `resetUrl` |
| `invitation-email` | `inviterName: string`, `organizationName: string`, `acceptUrl: string` | "You've been invited to {orgName}" | "Accept Invitation" → `acceptUrl` |

**Visual style:** Clean, minimal card — white background, light gray border, dark text, single black CTA button. No heavy branding. Template users customize colors/logos for their product.

Each template includes a fallback text line below the CTA: "Or copy and paste this URL into your browser: {url}" for email clients that don't render buttons.

### `package.json` exports

Each sender function and template gets its own export path:

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./keys": "./keys.ts",
    "./send-welcome-and-verify-email": "./src/send-welcome-and-verify-email.ts",
    "./send-welcome-email": "./src/send-welcome-email.ts",
    "./send-email-change-verification-email": "./src/send-email-change-verification-email.ts",
    "./send-password-reset-email": "./src/send-password-reset-email.ts",
    "./send-invitation-email": "./src/send-invitation-email.ts",
    "./templates/welcome-and-verify-email": "./src/templates/welcome-and-verify-email.tsx",
    "./templates/welcome-email": "./src/templates/welcome-email.tsx",
    "./templates/email-change-verification-email": "./src/templates/email-change-verification-email.tsx",
    "./templates/password-reset-email": "./src/templates/password-reset-email.tsx",
    "./templates/invitation-email": "./src/templates/invitation-email.tsx",
    "./provider": "./src/provider/index.ts"
  }
}
```

## App: `apps/email-preview`

### Purpose

Local development preview server for all email templates. Runs the React Email CLI, not Next.js.

### Directory structure

```
apps/email-preview/
├── package.json
├── tsconfig.json
├── eslint.config.mjs
├── emails/
│   ├── welcome-and-verify-email.tsx
│   ├── welcome-email.tsx
│   ├── email-change-verification-email.tsx
│   ├── password-reset-email.tsx
│   └── invitation-email.tsx
```

### Configuration

- **Port**: 4002 (dashboard is 4000, www is 4001)
- **Scripts**: `"dev": "email dev --port 4002"`, `"export": "email export"`
- **Dependencies**: `react-email`, `@react-email/components`, `@workspace/email`, `react`
- **Turborepo**: included in `pnpm dev` via the existing `dev` task (all apps with a `dev` script run in parallel)

### Preview files

Each file in `emails/` imports a template from `@workspace/email/templates/*` and renders it with realistic sample data:

```typescript
import { WelcomeAndVerifyEmail } from "@workspace/email/templates/welcome-and-verify-email";

export default function Preview() {
  return (
    <WelcomeAndVerifyEmail
      name="Jane Doe"
      verifyUrl="https://app.example.com/verify?token=abc123"
    />
  );
}
```

## Auth integration

### Changes to `packages/auth/src/auth.ts`

Replace the three `console.log` stubs with real sender function calls. The `@workspace/email` package becomes a dependency of `@workspace/auth`.

**`sendVerificationEmail`** — routes to different templates based on `user.emailVerified`:

```typescript
sendVerificationEmail: async ({ user, url }) => {
  if (user.emailVerified) {
    await sendEmailChangeVerificationEmail({
      recipient: user.email,
      name: user.name,
      verifyUrl: url,
    });
  } else {
    await sendWelcomeAndVerifyEmail({
      recipient: user.email,
      name: user.name,
      verifyUrl: url,
    });
  }
},
```

When `emailVerified` is true, the user already verified their original email — this verification must be for an email change. When false, this is a new account verifying for the first time.

**`sendResetPasswordEmail`**:

```typescript
sendResetPasswordEmail: async ({ user, url }) => {
  await sendPasswordResetEmail({
    recipient: user.email,
    name: user.name,
    resetUrl: url,
  });
},
```

**`sendInvitationEmail`** (organization plugin):

```typescript
async sendInvitationEmail(data) {
  const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:4000";
  await sendInvitationEmail({
    recipient: data.email,
    organizationName: data.organization.name,
    inviterName: data.inviter.user.name,
    acceptUrl: `${baseUrl}/accept-invitation/${data.id}`,
  });
},
```

Note: The imported `sendInvitationEmail` from `@workspace/email` is not shadowed by the method shorthand name — JS method shorthand property names don't create bindings in the method body's scope.

### Standalone welcome email

When `requireEmailVerification` is `false`, the welcome-and-verify template is not triggered on signup. In this configuration, the standalone `sendWelcomeEmail` can be called from app-level code (e.g. a post-signup server action). This is intentionally left as an integration point — the template and sender exist, but wiring it into a specific signup flow is up to the template user.

## Environment setup

### New variables in `.env.example`

```bash
# Email (Resend) — optional in development, required in production
# Get your API key at https://resend.com/api-keys
# RESEND_API_KEY=re_xxxxxxxxx
# EMAIL_FROM="App Name <noreply@yourdomain.com>"
```

Both are commented out by default. When absent, sender functions log email details to the console instead of sending.

## Testing

All tests use Vitest. Located in `packages/email/__tests__/`.

### 1. Template render smoke tests (`template-render.test.ts`)

For each of the 5 templates: render with valid props using `@react-email/render`, assert the result is non-empty HTML and non-empty plain text. Catches broken imports, missing props, and React rendering errors. No mocks needed.

**Cases (5 tests):**
- `WelcomeAndVerifyEmail` renders to HTML and text
- `WelcomeEmail` renders to HTML and text
- `EmailChangeVerificationEmail` renders to HTML and text
- `PasswordResetEmail` renders to HTML and text
- `InvitationEmail` renders to HTML and text

### 2. Sender function unit tests (`sender-functions.test.ts`)

Mock `EmailProvider.sendEmail`. For each sender: call with sample props, assert the provider was called once with the correct `recipient`, expected `subject`, and non-empty `html`/`text` strings.

**Cases (5 tests):**
- `sendWelcomeAndVerifyEmail` calls provider with "Welcome! Please verify your email" subject
- `sendWelcomeEmail` calls provider with "Welcome!" subject
- `sendEmailChangeVerificationEmail` calls provider with "Confirm your new email address" subject
- `sendPasswordResetEmail` calls provider with "Reset your password" subject
- `sendInvitationEmail` calls provider with "You've been invited to {orgName}" subject

### 3. Auth hook routing logic (`auth-hook-routing.test.ts`)

Test the `sendVerificationEmail` branching logic that decides between welcome-and-verify vs email-change-verification based on `user.emailVerified`.

**Cases (2 tests):**
- When `emailVerified` is `false` → calls `sendWelcomeAndVerifyEmail`
- When `emailVerified` is `true` → calls `sendEmailChangeVerificationEmail`

### 4. Graceful degradation (`graceful-degradation.test.ts`)

With `RESEND_API_KEY` unset, call each sender function. Assert it does not throw and logs the email details to console.

**Cases (5 tests):**
- Each of the 5 sender functions logs and returns without throwing when API key is missing

### 5. Resend provider error handling (`resend-provider.test.ts`)

Mock the Resend SDK's `emails.send()` method. Test error handling behavior.

**Cases (3 tests):**
- Successful send returns `{ id }` from the provider
- Resend returns `{ data: null, error: { message: "rate limited" } }` → provider throws meaningful error
- Resend returns `{ data: null, error: { message: "invalid API key" } }` → provider throws meaningful error
