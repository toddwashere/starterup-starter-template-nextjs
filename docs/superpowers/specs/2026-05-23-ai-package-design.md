# AI Package (`@workspace/ai`) Design

**Date:** 2026-05-23  
**Status:** Approved

## Overview

Add centralized LLM infrastructure for the monorepo: a new `@workspace/ai` package built on the Vercel AI SDK, with env-selected providers (OpenRouter, Ollama, direct OpenAI/Anthropic, OpenAI-compatible gateways). Dashboard **AI Assistant** gets streaming chat, capped MCP tool loops, persisted threads in Postgres, and optional Langfuse tracing. `apps/workers` shares the same generation APIs for background jobs. Quality is addressed with optional Langfuse observability, in-chat feedback, and **promptfoo** evals in CI—not a custom trace store in app Postgres.

---

## Decisions

| Topic | Decision |
|-------|----------|
| **LLM library** | Vercel AI SDK (`ai` + `@ai-sdk/*`, `@openrouter/ai-sdk-provider`) |
| **Vercel hosting** | Not required; calls go from app servers to configured providers |
| **Package shape** | **Approach 2** — `@workspace/ai` owns model factory, agent runner, prompts, telemetry; callers inject tool execution |
| **Consumers** | Dashboard chat + `apps/workers` |
| **Chat tools** | **C** — MCP tools via capped agent loop (`AI_AGENT_MAX_STEPS`, default `5`) |
| **Chat persistence** | **B** — `AiThread` / `AiMessage` in Postgres |
| **Thread repos** | `packages/ai-chat` (repos only); dashboard feature owns actions, UI, MCP adapter |
| **Prisma schema file** | `packages/database/prisma/ai.prisma` (not `mcp.prisma`) |
| **Billing gate** | **A** — no entitlement check in v1 |
| **Observability** | Optional Langfuse (env-gated); link traces via message metadata |
| **Offline evals** | `evals/promptfoo/` + CI workflow; not a runtime dependency |
| **User feedback** | Thumbs up/down + optional comment on assistant messages in v1 |
| **Thread list UI** | Single active thread per org context in v1; multi-thread sidebar later |
| **Providers in v1** | All adapters documented below |
| **Model routing** | Central catalog in `ai-models-available.ts` — not `AI_PROVIDER` / `AI_MODEL` env |
| **Availability** | Runtime filter: only providers with configured API keys |
| **Chat UI** | `AiProviderModelSelect` — user picks from available models per request |
| **Implementation plan** | [`2026-05-23-ai-models-catalog-and-selector.md`](../plans/2026-05-23-ai-models-catalog-and-selector.md) |

---

## Scope

### In scope

- `packages/ai` — `keys.ts`, `getModel()`, `runAgent()`, `generateWithDefaults()`, prompt modules, telemetry helper
- `packages/ai-chat` — `ai-thread-repo`, `ai-message-repo`, Zod types/schemas, barrel exports
- `packages/database/prisma/ai.prisma` — `AiThread`, `AiMessage` + migration
- `packages/common` — extend `IdPrefix` with `AiIdPrefix` (`aith`, `aimsg`)
- `apps/dashboard` — streaming chat route, ai-chat feature (MCP adapter, actions, UI, feedback)
- `apps/workers` — example handler calling `generateText` (no MCP HTTP)
- `.env.example` — AI + Langfuse vars (all optional until features used)
- `evals/promptfoo/` — starter config + golden cases for system prompt
- README section — provider matrix, Ollama local dev, optional Langfuse self-host/cloud

### Out of scope (v1)

- Stripe / `@workspace/billing` entitlements for AI
- Per-org or per-user LLM API keys in DB
- Thread sidebar / multi-thread picker UI
- Export chats → Langfuse datasets (document as follow-up)
- Custom OTEL trace storage in Prisma
- LLM calls from client components or `NEXT_PUBLIC_*` model keys
- Mandatory Langfuse (app runs without it)
- `packages/ai` importing Prisma, MCP HTTP, or `apps/*`

---

## Architecture

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ apps/dashboard                                                           │
│  app/api/ai/chat/route.ts     POST stream (useChat consumer)             │
│  features/ai-chat/                                                       │
│    data/ai-chat-actions.ts    load thread, feedback, list tools (MCP)    │
│    data/mcp-agent-tools.ts    build AI SDK tools from MCP tools/list     │
│    data/mcp-tool-executor.ts  session cookie → public-mcp tools/call     │
│    ui/                       stream UI, tool cards, thumbs               │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
 @workspace/ai-chat      @workspace/ai            @workspace/common/mcp
 (thread repos)           (model + agent)          (existing HTTP client)
        │                       │
        ▼                       ▼
 @workspace/database      Provider APIs
 (ai.prisma)              OpenRouter / Ollama / OpenAI / Anthropic
                                │
                    optional ───┴─── Langfuse (OTEL via AI SDK telemetry)

┌──────────────────────────────────────────────────────────────────────────┐
│ apps/workers                                                             │
│  handlers/ai-example.ts (or similar) → generateText / runAgent           │
│  tools: in-process Zod tools only (no MCP HTTP)                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Separation of concerns

| Layer | Responsibility |
|-------|----------------|
| **`packages/ai`** | Provider factory, generation defaults, capped multi-step agent, versioned system prompts, telemetry options |
| **`packages/ai-chat`** | Org/user-scoped thread and message persistence |
| **Dashboard feature** | Auth guards, org context, MCP session pass-through, streaming HTTP, UI |
| **`mcp.prisma`** | Unchanged — `McpToolCallLog` audit only |
| **Langfuse** | Optional traces/experiments; separate storage from app DB |

---

## Model catalog (`ai-models-available.ts`)

**Not env-based routing.** All supported models are defined in `packages/ai/src/ai-models-available.ts` for use by chat, workers, evals, and future features.

### Catalog shape

- Per-provider arrays: `OPENROUTER_MODELS`, `OPENAI_MODELS`, `ANTHROPIC_MODELS`, `OLLAMA_MODELS`, `OPENAI_COMPAT_MODELS`
- `AI_MODELS_BY_PROVIDER` — full allowlist
- Encoding: `provider:modelId` (e.g. `openrouter:anthropic/claude-sonnet-4`, `anthropic:claude-sonnet-4-20250514`)
- Helpers: `parseProviderModelValue`, `toProviderModelValue`, `isKnownCatalogModel`, `getAiProviderModelOptions`

### Presets (code defaults)

```typescript
export const AI_MODEL_PRESETS = {
  assistant: "openrouter:anthropic/claude-sonnet-4",
  worker: "openai:gpt-4o-mini",
  local: "ollama:llama3.2",
} as const;
```

Call sites:

- Chat: user selection from UI, validated on server; fallback `getDefaultAvailableProviderModel()`
- Workers: `getModel({ preset: "worker" })`

### Runtime availability (env keys only)

`getAvailableAiModels(keys())` returns dropdown options **filtered** by configured credentials:

| Provider | Available when |
|----------|----------------|
| `openrouter` | `OPENROUTER_API_KEY` set |
| `openai` | `OPENAI_API_KEY` set |
| `anthropic` | `ANTHROPIC_API_KEY` set |
| `ollama` | `OLLAMA_BASE_URL` set or default localhost |
| `openai-compatible` | `AI_OPENAI_COMPAT_BASE_URL` set |

Server **must** call `resolveProviderModel(config, value)` before `getModel()` — rejects unknown catalog entries and providers without keys (do not trust client-only filtering).

### UI

- `AiProviderModelSelect` in `apps/dashboard/features/ai-chat/ui/`
- Options from `listAvailableAiModelsAction()` (server)
- Chat transport sends `providerModel` on each `/api/ai/chat` POST

---

## Environment variables

Secrets and global knobs only — **no** `AI_PROVIDER` or `AI_MODEL`.

```bash
# ── LLM (@workspace/ai) ─────────────────────────────────────────────────────
# Models: packages/ai/src/ai-models-available.ts

AI_AGENT_MAX_STEPS=5
# AI_MAX_OUTPUT_TOKENS=4096
# AI_TEMPERATURE=0.7

# Provider API keys (set any subset — UI lists only configured providers)
# OPENROUTER_API_KEY=
# OPENROUTER_HTTP_REFERER=http://localhost:4000
# OPENROUTER_APP_NAME=starter-dev
# OPENAI_API_KEY=
# OPENAI_BASE_URL=https://api.openai.com/v1
# ANTHROPIC_API_KEY=
# OLLAMA_BASE_URL=http://localhost:11434/v1
# AI_OPENAI_COMPAT_BASE_URL=
# AI_OPENAI_COMPAT_API_KEY=

# ── Langfuse (optional) ─────────────────────────────────────────────────────
# LANGFUSE_PUBLIC_KEY=
# LANGFUSE_SECRET_KEY=
# LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

**Provider SDK mapping (`getModel({ providerModel })`):**

| Provider | SDK | Required env |
|----------|-----|----------------|
| `openrouter` | `@openrouter/ai-sdk-provider` | `OPENROUTER_API_KEY` |
| `openai` | `@ai-sdk/openai` | `OPENAI_API_KEY` |
| `anthropic` | `@ai-sdk/anthropic` | `ANTHROPIC_API_KEY` |
| `ollama` | `@ai-sdk/openai` + `baseURL` | `OLLAMA_BASE_URL` (default localhost) |
| `openai-compatible` | `@ai-sdk/openai` + `baseURL` | `AI_OPENAI_COMPAT_BASE_URL` |

---

## Data model (`ai.prisma`)

New file: `packages/database/prisma/ai.prisma`.

```prisma
enum AiMessageRole {
  user
  assistant
  tool
}

enum AiMessageFeedback {
  helpful
  not_helpful
}

model AiThread {
  id             String   @id // createId("aith")
  organizationId String
  userId         String
  title          String?  // optional; v1 may leave null or set from first message
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  messages     AiMessage[]

  @@index([organizationId, updatedAt])
  @@index([userId, organizationId])
  @@map("aiThread")
}

model AiMessage {
  id        String   @id // createId("aimsg")
  threadId  String
  role      AiMessageRole
  content   String   @db.Text
  /// JSON: tool calls / results for assistant turns (ToolResult[])
  toolPayload Json?
  feedback  AiMessageFeedback?
  feedbackComment String? @db.Text
  /// e.g. { langfuseTraceId?: string }
  metadata  Json?
  createdAt DateTime @default(now())

  thread AiThread @relation(fields: [threadId], references: [id], onDelete: Cascade)

  @@index([threadId, createdAt])
  @@map("aiMessage")
}
```

**Add relations** on `User` and `Organization` in `auth.prisma`:

```prisma
aiThreads AiThread[]
```

**ID prefixes** (in `@workspace/common`):

- `aith` — thread  
- `aimsg` — message  

Repos must call `createId()` on create; never rely on `@default(cuid())` for app-owned IDs.

**v1 thread UX:** One “current” thread per user+org — `getOrCreateActiveThread(userId, organizationId)` in repo. Multi-thread list is a follow-up (`listThreadsForOrg` can exist in repo but UI unused).

---

## `packages/ai-chat`

Thin domain package (like `@workspace/contacts`), **no** LLM imports.

```
packages/ai-chat/
├── package.json          # @workspace/ai-chat
├── src/
│   ├── index.ts
│   ├── schemas/
│   │   └── ai-chat-schemas.ts   # feedback input, message DTOs
│   └── data-models/
│       ├── ai-thread-repo.ts
│       ├── ai-thread-repo.test.ts
│       ├── ai-message-repo.ts
│       └── ai-message-repo.test.ts
```

**Repo functions (minimum):**

- `getOrCreateActiveThread({ userId, organizationId })`
- `getThreadById({ threadId, organizationId, userId })` — enforce ownership
- `listMessagesForThread({ threadId, organizationId, userId })`
- `appendUserMessage(...)`, `appendAssistantMessage(...)` — include `toolPayload`, `metadata`
- `setMessageFeedback({ messageId, organizationId, userId, feedback, comment? })` — assistant messages only

All queries **must** scope by `organizationId` (and `userId` where product requires private threads).

---

## `packages/ai`

```
packages/ai/
├── package.json
├── keys.ts
├── src/
│   ├── index.ts
│   ├── ai-models-available.ts    # full catalog + presets + parse/to (client-safe)
│   ├── list-available-ai-models.ts  # filter by env keys (server)
│   ├── resolve-provider-model.ts    # allowlist + key check
│   ├── get-model.ts              # getModel({ providerModel } | { preset })
│   ├── get-model.test.ts
│   ├── generation-defaults.ts
│   ├── telemetry.ts
│   ├── run-agent.ts
│   ├── run-agent.test.ts
│   └── prompts/
│       └── assistant-system.ts
```

### Public API (v1)

```typescript
// Resolves from catalog + env keys — throws if invalid or unconfigured
export function getModel(
  options: { providerModel: ProviderModelValue } | { preset: AiModelPreset },
): LanguageModel;

export function getGenerationDefaults(): {
  maxOutputTokens?: number;
  temperature?: number;
};

export function buildTelemetryOptions(ctx: {
  functionId: string;
  userId?: string;
  orgId?: string;
  sessionId?: string; // thread id
  langfuseTraceId?: string;
}): { experimental_telemetry: ... };

export type AgentTool = Tool; // AI SDK tool type
export type ExecuteToolFn = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export async function runAgent(input: {
  messages: CoreMessage[];
  system: string;
  tools: Record<string, AgentTool>;
  executeTool: ExecuteToolFn;
  maxSteps?: number; // default from keys AI_AGENT_MAX_STEPS
  onStepFinish?: (step) => void;
}): Promise<{
  text: string;
  steps: ...;
  usage: ...;
  traceMetadata?: { langfuseTraceId?: string };
}>;
```

**`runAgent` behavior:**

1. Call `streamText` or `generateText` with `maxSteps` from env (default 5).
2. On each tool call, invoke `executeTool` (dashboard → MCP; workers → in-process).
3. Attach `buildTelemetryOptions()` on every model call when Langfuse keys present.
4. Do not import MCP or Prisma.

### Dependencies

- `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@openrouter/ai-sdk-provider`, `zod`
- Langfuse OTEL packages only if needed for span processor (optional peer or lazy init when keys set)
- **Must not** depend on `@workspace/database`, `@workspace/ai-chat`, `apps/*`

---

## Dashboard: chat + MCP

### Streaming route

`apps/dashboard/app/api/ai/chat/route.ts`:

1. Authenticate user + resolve active org (same guards as other org features).
2. Load or create thread via `@workspace/ai-chat`.
3. Persist user message.
4. Build messages from DB → AI SDK `CoreMessage[]`.
5. Fetch MCP tools via existing `listMcpToolsAction` / HTTP client pattern.
6. Map MCP JSON schemas → AI SDK `tool()` definitions (`mcp-agent-tools.ts`).
7. `runAgent` with `executeTool` calling session MCP (`mcp-tool-executor.ts` — reuse `@workspace/common/mcp/http-client`).
8. Stream response to client (`streamText` + AI SDK UI stream protocol, or `toDataStreamResponse()` per current SDK docs).
9. On finish: persist assistant message + `toolPayload` + `metadata.langfuseTraceId`.

### MCP tool mapping

- Tool names must match MCP `tools/list` names.
- Arguments validated with Zod where possible; pass through to `tools/call`.
- Tool errors surfaced to model and UI (existing `tool-result-card` pattern).

### UI (`features/ai-chat`)

- `useChat` with `/api/ai/chat`; body includes `providerModel` from `AiProviderModelSelect`.
- `listAvailableAiModelsAction()` on mount — populate selector; empty state when no keys.
- Keep `ChatMessage` / `ToolResult` types; align with DB-backed messages on load.
- **Feedback:** thumbs on assistant messages → server action → `setMessageFeedback`.

### Auth

- `requireUser` + org membership for thread access.
- No billing entitlement in v1.

---

## Workers

Example handler `ai.summarize` (name TBD) in `apps/workers`:

- Calls `generateText` from `@workspace/ai` with a small prompt (no MCP).
- Documents pattern for `runAgent` with local Zod tools if needed later.
- Does not use `@workspace/ai-chat` unless a future job needs audit logs in threads.

---

## Quality: Langfuse + promptfoo + feedback

### Langfuse (optional)

- Enabled when `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are set.
- Use AI SDK `experimental_telemetry` + Langfuse OpenTelemetry span processor (see [Langfuse Vercel AI SDK integration](https://langfuse.com/integrations/frameworks/vercel-ai-sdk)).
- Store `langfuseTraceId` on `AiMessage.metadata` for assistant turns.
- README: Cloud hobby tier vs self-hosted OSS (MIT, unlimited usage; infra cost only).

**Data location:** Chat text in **app Postgres**; traces in **Langfuse** (cloud or self-hosted DBs)—not merged into Prisma.

### promptfoo (CI)

```
evals/promptfoo/
├── promptfooconfig.yaml
├── prompts/
│   └── assistant-system.txt   # mirror or symlink to packages/ai prompt for evals
└── tests/
    └── golden.yaml
```

- Root script: `pnpm eval:ai` → `npx promptfoo eval`.
- Optional GitHub Action on changes to `packages/ai/src/prompts/**` or `evals/promptfoo/**`.
- Uses same provider env as dev (`OPENROUTER_API_KEY` or `OPENAI_API_KEY`).

### In-app feedback

- `AiMessageFeedback` enum on assistant messages.
- Optional `feedbackComment` for “what went wrong”.
- Future: export low-rated rows to Langfuse datasets (out of scope v1).

---

## Package exports

**`@workspace/ai`**

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./keys": "./keys.ts",
    "./ai-models-available": "./src/ai-models-available.ts",
    "./list-available-ai-models": "./src/list-available-ai-models.ts",
    "./resolve-provider-model": "./src/resolve-provider-model.ts",
    "./prompts/assistant-system": "./src/prompts/assistant-system.ts"
  }
}
```

**`@workspace/ai-chat`**

```json
{
  "exports": {
    ".": "./src/index.ts"
  }
}
```

---

## Critical Tests

- `packages/ai/src/get-model.test.ts`: `getModel({ providerModel })` and `getModel({ preset })`; missing key throws readable error.
- `packages/ai/src/list-available-ai-models.test.ts`: filters catalog by stubbed env keys.
- `packages/ai/src/resolve-provider-model.test.ts`: rejects unknown model id and unconfigured provider.
- `packages/ai/src/run-agent.test.ts`: stops at `maxSteps`; `executeTool` invoked with correct name/args; tool errors propagated; telemetry helper no-ops when Langfuse unset.
- `packages/ai-chat/src/data-models/ai-thread-repo.test.ts`: `getOrCreateActiveThread` scopes by user+org; cannot read other org’s thread.
- `packages/ai-chat/src/data-models/ai-message-repo.test.ts`: append messages ordering; `setMessageFeedback` rejects non-assistant / wrong user.
- `apps/dashboard/features/ai-chat/data/mcp-agent-tools.test.ts`: maps MCP schema to AI SDK tools; unknown tool skipped or handled safely.
- `evals/promptfoo/` — not unit tests; CI runs `pnpm eval:ai` (document in plan).

---

## Verification

- `pnpm type-check`
- `pnpm lint`
- `pnpm test --filter @workspace/ai --filter @workspace/ai-chat`
- `pnpm test --filter dashboard` (ai-chat feature tests)
- Manual: Ollama or OpenRouter configured → AI Assistant streams reply; MCP tool call appears in UI; refresh restores thread; feedback saves
- Optional: Langfuse keys set → trace visible in Langfuse UI linked from message metadata

---

## Follow-ups (post-v1)

- Thread list sidebar + `title` generation from first message
- `@workspace/billing` entitlement gate for AI Assistant
- Export negative feedback → Langfuse dataset → promptfoo case
- Worker jobs that use `runAgent` with domain tools (no MCP HTTP)
- Per-org model overrides in DB

---

## References

- Existing: `apps/dashboard/features/ai-chat/`, `@workspace/common/mcp/http-client`, `docs/superpowers/specs/2026-05-10-public-api-and-mcp-design.md`
- Skills: `.ai/skills/add-data-model-to-database/SKILL.md`
- External: [Vercel AI SDK](https://ai-sdk.dev), [OpenRouter AI SDK provider](https://ai-sdk.dev/providers/community-providers/openrouter), [Langfuse + AI SDK](https://langfuse.com/integrations/frameworks/vercel-ai-sdk), [promptfoo](https://github.com/promptfoo/promptfoo)
