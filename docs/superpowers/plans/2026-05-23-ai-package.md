# AI Package (`@workspace/ai`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@workspace/ai` (Vercel AI SDK + multi-provider env), `@workspace/ai-chat` (thread/message repos), dashboard streaming AI Assistant with capped MCP tools and DB history, optional Langfuse telemetry, workers example handler, and promptfoo eval scaffold.

> **Follow-up:** Model catalog, env-key filtering, and chat model selector — see [`2026-05-23-ai-models-catalog-and-selector.md`](./2026-05-23-ai-models-catalog-and-selector.md).

**Architecture:** `packages/ai` exposes `getModel()`, `runAgent()`, prompts, and telemetry—no Prisma or MCP. `packages/ai-chat` owns Prisma repos for `ai.prisma`. Dashboard wires MCP session tools into `runAgent` via `/api/ai/chat`. Workers call `generateText` only. See [`docs/superpowers/specs/2026-05-23-ai-package-design.md`](../specs/2026-05-23-ai-package-design.md).

**Tech Stack:** Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@openrouter/ai-sdk-provider`), Zod, Vitest, Prisma, optional Langfuse OTEL, promptfoo (dev/CI).

---

## File map

| File / area | Responsibility |
|-------------|----------------|
| `packages/common/src/create-id.ts` | `AiIdPrefix` (`aith`, `aimsg`) |
| `packages/database/prisma/ai.prisma` | `AiThread`, `AiMessage` models |
| `packages/database/prisma/auth.prisma` | `aiThreads` relations on User, Organization |
| `packages/ai-chat/` | Thread/message repos + schemas |
| `packages/ai/` | Model factory, agent, prompts, telemetry |
| `apps/dashboard/app/api/ai/chat/route.ts` | Streaming chat + persistence |
| `apps/dashboard/features/ai-chat/` | MCP adapters, actions, UI, feedback |
| `apps/workers/src/handlers/ai-example.ts` | Sample `generateText` job |
| `packages/worker-queue/src/events.ts` | Register `ai.example` event (optional name) |
| `evals/promptfoo/` | Golden eval config |
| `.env.example`, `README.md` | Provider + Langfuse docs |
| Root `package.json` | `"eval:ai"` script |

---

## Critical Tests

- `packages/common/src/create-id.test.ts`: `createId("aith")` / `createId("aimsg")` prefixes accepted.
- `packages/ai/src/get-model.test.ts`: each `AI_PROVIDER` resolves when keys present; missing key throws readable error; `ollama` default base URL.
- `packages/ai/src/run-agent.test.ts`: respects `maxSteps`; `executeTool` called with name/args; tool errors propagate; telemetry no-ops without Langfuse keys.
- `packages/ai-chat/src/data-models/ai-thread-repo.test.ts`: `getOrCreateActiveThread` scoped to user+org; cross-org read fails.
- `packages/ai-chat/src/data-models/ai-message-repo.test.ts`: message order; `setMessageFeedback` only on assistant rows.
- `apps/dashboard/features/ai-chat/data/mcp-agent-tools.test.ts`: MCP JSON schema → AI SDK `tool()`; invalid schema skipped safely.

---

### Task 1: AI ID prefixes in `@workspace/common`

**Files:**
- Modify: `packages/common/src/create-id.ts`
- Modify: `packages/common/src/index.ts`
- Modify: `packages/common/src/create-id.test.ts`

- [ ] **Step 1: Add `AiIdPrefix`**

```typescript
export type AiIdPrefix = "aith" | "aimsg";

export type IdPrefix =
  | AuthIdPrefix
  | ContactsIdPrefix
  | BillingIdPrefix
  | McpIdPrefix
  | AiIdPrefix
  | typeof temporaryIdPrefix;
```

Export `AiIdPrefix` from `index.ts`.

- [ ] **Step 2: Test**

```typescript
it("accepts ai prefixes", () => {
  expect(createId("aith")).toMatch(/^aith_/);
  expect(createId("aimsg")).toMatch(/^aimsg_/);
});
```

Run: `pnpm --filter @workspace/common test`

- [ ] **Step 3: Commit** `feat(common): add ai thread and message id prefixes`

---

### Task 2: Prisma `ai.prisma` + migration

**Files:**
- Create: `packages/database/prisma/ai.prisma`
- Modify: `packages/database/prisma/auth.prisma` (add `aiThreads AiThread[]` on `User` and `Organization`)
- Create: migration via `pnpm --filter @workspace/database db:migrate` (name e.g. `add_ai_chat`)

- [ ] **Step 1:** Copy models from spec (`AiMessageRole`, `AiMessageFeedback`, `AiThread`, `AiMessage`). IDs are `String @id` without `@default(cuid())`.

- [ ] **Step 2:** Add relations on `User` and `Organization`:

```prisma
aiThreads AiThread[]
```

- [ ] **Step 3:** Generate migration and run against local DB.

Run: `pnpm --filter @workspace/database exec prisma migrate dev --name add_ai_chat`

- [ ] **Step 4:** `pnpm --filter @workspace/database exec prisma generate`

- [ ] **Step 5: Commit** `feat(database): ai chat thread and message tables`

---

### Task 3: `@workspace/ai-chat` package + thread repo (TDD)

**Files:**
- Create: `packages/ai-chat/package.json`, `tsconfig.json`, `eslint.config.mjs`
- Create: `packages/ai-chat/src/index.ts`
- Create: `packages/ai-chat/src/schemas/ai-chat-schemas.ts`
- Create: `packages/ai-chat/src/data-models/ai-thread-repo.ts`
- Create: `packages/ai-chat/src/data-models/ai-thread-repo.test.ts`

- [ ] **Step 1:** Scaffold package (mirror `packages/contacts/package.json` deps: `@workspace/database`, `zod`, vitest, tooling).

- [ ] **Step 2:** Failing tests — mock `prisma` like `contact-tag-repo.test.ts`:

```typescript
// getOrCreateActiveThread returns existing thread for same userId+organizationId
// getThreadById returns null when organizationId mismatches
```

- [ ] **Step 3:** Implement `getOrCreateActiveThread`, `getThreadById` using `createId("aith")` on create. “Active” = most recently updated thread for pair, or create new.

- [ ] **Step 4:** Run `pnpm --filter @workspace/ai-chat test`

- [ ] **Step 5: Commit** `feat(ai-chat): thread repository`

---

### Task 4: Message repo + feedback (TDD)

**Files:**
- Create: `packages/ai-chat/src/data-models/ai-message-repo.ts`
- Create: `packages/ai-chat/src/data-models/ai-message-repo.test.ts`
- Modify: `packages/ai-chat/src/index.ts` (export repos + schemas)

- [ ] **Step 1:** Failing tests for `listMessagesForThread` (ordered `createdAt asc`), `appendUserMessage`, `appendAssistantMessage` (with `toolPayload`, `metadata`), `setMessageFeedback` (reject `role: user`).

- [ ] **Step 2:** Implement; use `createId("aimsg")`; verify thread belongs to `userId` + `organizationId` before writes.

- [ ] **Step 3:** Export Zod `setMessageFeedbackInput` in schemas.

- [ ] **Step 4:** Tests pass; commit `feat(ai-chat): message repository and feedback`

---

### Task 5: `@workspace/ai` scaffold + `keys.ts`

**Files:**
- Create: `packages/ai/package.json`, `tsconfig.json`, `eslint.config.mjs`, `keys.ts`
- Create: `packages/ai/src/index.ts` (re-exports stub)

- [ ] **Step 1:** Add dependencies (user runs `pnpm add` in `packages/ai`):

  - `ai`
  - `@ai-sdk/openai`
  - `@ai-sdk/anthropic`
  - `@openrouter/ai-sdk-provider`
  - `zod`

  Optional for Langfuse (add when implementing telemetry task): `@langfuse/tracing`, `@langfuse/otel` per [Langfuse AI SDK docs](https://langfuse.com/integrations/frameworks/vercel-ai-sdk).

- [ ] **Step 2:** Implement `keys.ts` Zod schema per spec (`AI_PROVIDER` enum optional, provider keys optional strings, `AI_AGENT_MAX_STEPS` default 5).

- [ ] **Step 3:** Export `./keys` in `package.json`; wire turbo `type-check` / `test`.

- [ ] **Step 4: Commit** `feat(ai): package scaffold and env keys`

---

### Task 6: `getModel()` + generation defaults (TDD)

**Files:**
- Create: `packages/ai/src/get-model.ts`, `get-model.test.ts`
- Create: `packages/ai/src/generation-defaults.ts`
- Modify: `packages/ai/src/index.ts`

- [ ] **Step 1:** Failing tests with `vi.stubEnv`:

```typescript
it("throws when AI_PROVIDER unset", () => {
  vi.stubEnv("AI_PROVIDER", "");
  expect(() => getModel()).toThrow(/not configured/i);
});

it("openrouter uses OPENROUTER_API_KEY", () => {
  vi.stubEnv("AI_PROVIDER", "openrouter");
  vi.stubEnv("OPENROUTER_API_KEY", "sk-test");
  vi.stubEnv("AI_MODEL", "openai/gpt-4o-mini");
  expect(getModel()).toBeDefined();
});
```

Cover `ollama` default `OLLAMA_BASE_URL`, `openai-compatible` requiring `AI_OPENAI_COMPAT_BASE_URL`.

- [ ] **Step 2:** Implement `getModel()` switch per spec provider table. `getDefaultModelForProvider()` when `AI_MODEL` unset.

- [ ] **Step 3:** `getGenerationDefaults()` reads `AI_MAX_OUTPUT_TOKENS`, `AI_TEMPERATURE`.

- [ ] **Step 4:** Run `pnpm --filter @workspace/ai test`; commit `feat(ai): provider factory and generation defaults`

---

### Task 7: System prompt + telemetry helper

**Files:**
- Create: `packages/ai/src/prompts/assistant-system.ts`
- Create: `packages/ai/src/telemetry.ts`
- Create: `packages/ai/src/telemetry.test.ts`

- [ ] **Step 1:** `ASSISTANT_SYSTEM_PROMPT` constant — instruct model to use MCP tools when helpful, cite org context, stay concise.

- [ ] **Step 2:** `buildTelemetryOptions(ctx)` returns `{ experimental_telemetry: { isEnabled: false } }` when `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` missing.

- [ ] **Step 3:** When keys set, `isEnabled: true`, set `functionId`, `metadata` with `userId`, `orgId`, `sessionId` (thread id). Document Langfuse OTEL bootstrap in `packages/ai/README.md` (app must register span processor once — dashboard `instrumentation.ts` or route-local per Langfuse cookbook).

- [ ] **Step 4:** Test no-op path without keys.

- [ ] **Step 5: Commit** `feat(ai): assistant prompt and optional langfuse telemetry`

---

### Task 8: `runAgent()` (TDD)

**Files:**
- Create: `packages/ai/src/run-agent.ts`, `run-agent.test.ts`
- Modify: `packages/ai/src/index.ts`

- [ ] **Step 1:** Failing tests with mocked `generateText` from `ai` (vi.mock):

```typescript
vi.mock("ai", () => ({
  generateText: vi.fn().mockResolvedValue({
    text: "done",
    steps: [],
    usage: { totalTokens: 1 },
  }),
}));
```

Assert `maxSteps` passed from `keys().AI_AGENT_MAX_STEPS`; assert `tools` forwarded.

- [ ] **Step 2:** Implement `runAgent` using `generateText` from `ai` with:

```typescript
import { generateText } from "ai";
import { getModel } from "./get-model.js";
import { getGenerationDefaults } from "./generation-defaults.js";
import { buildTelemetryOptions } from "./telemetry.js";

export async function runAgent(input: RunAgentInput) {
  const k = keys();
  return generateText({
    model: getModel(),
    system: input.system,
    messages: input.messages,
    tools: input.tools,
    maxSteps: input.maxSteps ?? k.AI_AGENT_MAX_STEPS,
    ...getGenerationDefaults(),
    ...buildTelemetryOptions({
      functionId: "run-agent",
      userId: input.telemetry?.userId,
      orgId: input.telemetry?.orgId,
      sessionId: input.telemetry?.sessionId,
    }),
  });
}
```

Use AI SDK v6 `maxSteps` + tool execution per current docs (tools with `execute` callbacks wrapping `input.executeTool`).

- [ ] **Step 3:** Map tool results for caller to persist in `toolPayload`.

- [ ] **Step 4:** Tests pass; commit `feat(ai): capped agent runner`

---

### Task 9: Env example + README

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Create: `packages/ai/README.md` (short)

- [ ] **Step 1:** Paste AI + Langfuse block from spec into `.env.example`.

- [ ] **Step 2:** README section: provider matrix, local Ollama quickstart, OpenRouter, optional Langfuse cloud/self-host, `pnpm eval:ai`.

- [ ] **Step 3: Commit** `docs: ai package env and readme`

---

### Task 10: Dashboard MCP tool bridge (TDD)

**Files:**
- Create: `apps/dashboard/features/ai-chat/data/mcp-tool-executor.ts`
- Create: `apps/dashboard/features/ai-chat/data/mcp-agent-tools.ts`
- Create: `apps/dashboard/features/ai-chat/data/mcp-agent-tools.test.ts`
- Modify: `apps/dashboard/package.json` — add `@workspace/ai`, `@workspace/ai-chat`

- [ ] **Step 1:** `mcp-tool-executor.ts` — `executeMcpTool(cookie, toolName, args)` using `mcpStreamableHttpPost` + `readMcpJsonRpcResponse` (extract from `ai-chat-actions.ts`).

- [ ] **Step 2:** `mcp-agent-tools.ts` — `buildToolsFromMcpList(tools, executeTool)` maps MCP `inputSchema` to `tool({ parameters: jsonSchema(...) })` per AI SDK.

- [ ] **Step 3:** Unit test with fixture MCP tool list (account-info shape).

- [ ] **Step 4: Commit** `feat(dashboard): mcp to ai sdk tool adapter`

---

### Task 11: Chat server actions (load thread, feedback)

**Files:**
- Modify: `apps/dashboard/features/ai-chat/data/ai-chat-actions.ts`
- Modify: `apps/dashboard/features/ai-chat/data/ai-chat-types.ts`

- [ ] **Step 1:** `loadChatThreadAction()` — `requireOrgPermissionWithActiveOrg`, `getOrCreateActiveThread`, `listMessagesForThread`, map to `ChatMessage[]`.

- [ ] **Step 2:** `setMessageFeedbackAction(messageId, feedback, comment?)` — Zod validate, call repo.

- [ ] **Step 3:** Keep `listMcpToolsAction` / refactor `mcpPost` shared with executor.

- [ ] **Step 4:** Colocated tests if actions contain logic; else rely on repo tests.

- [ ] **Step 5: Commit** `feat(dashboard): ai chat persistence actions`

---

### Task 12: Streaming `/api/ai/chat` route

**Files:**
- Create: `apps/dashboard/app/api/ai/chat/route.ts`

- [ ] **Step 1:** `POST` handler:

  1. Session auth (`auth.api.getSession` or existing dashboard pattern).
  2. Resolve `activeOrganizationId` from session.
  3. Parse body `{ message: string }` (or AI SDK `useChat` message format).
  4. `appendUserMessage`.
  5. Load history → `CoreMessage[]`.
  6. `listMcpTools` + `buildToolsFromMcpList`.
  7. `streamText` (preferred for UX) with same model/tools/`maxSteps` as `runAgent`, `ASSISTANT_SYSTEM_PROMPT`, telemetry metadata.
  8. Return `result.toUIMessageStreamResponse()` (or current AI SDK streaming helper).
  9. `onFinish`: `appendAssistantMessage` with text, tool results, `metadata.langfuseTraceId` if available.

- [ ] **Step 2:** Return 503 with clear JSON when `getModel()` throws (AI not configured).

- [ ] **Step 3:** Manual test with `public-mcp` + OpenRouter/Ollama running.

- [ ] **Step 4: Commit** `feat(dashboard): streaming ai chat api route`

---

### Task 13: AI chat UI (useChat + feedback)

**Files:**
- Modify: `apps/dashboard/features/ai-chat/ui/ai-chat-page-content.tsx`
- Modify: `apps/dashboard/features/ai-chat/ui/chat-message.tsx`
- Create: `apps/dashboard/features/ai-chat/ui/message-feedback.tsx`

- [ ] **Step 1:** On mount, `loadChatThreadAction` hydrates `messages` state.

- [ ] **Step 2:** Wire `@ai-sdk/react` `useChat({ api: "/api/ai/chat" })` (add dependency to dashboard if missing).

- [ ] **Step 3:** Render streaming assistant text; show `tool-result-card` from message metadata / parts.

- [ ] **Step 4:** Thumbs up/down on assistant messages → `setMessageFeedbackAction`.

- [ ] **Step 5: Commit** `feat(dashboard): streaming ai assistant ui with feedback`

---

### Task 14: Workers example handler

**Files:**
- Create: `apps/workers/src/handlers/ai-example.ts`
- Create: `apps/workers/src/handlers/ai-example.test.ts`
- Modify: `apps/workers/src/registry.ts`
- Modify: `packages/worker-queue/src/events.ts`
- Modify: `apps/workers/package.json` — depend on `@workspace/ai`

- [ ] **Step 1:** Register event `ai.example` with payload `{ text: string }`.

- [ ] **Step 2:** Handler calls:

```typescript
import { generateText } from "ai";
import { getModel, getGenerationDefaults, buildTelemetryOptions } from "@workspace/ai";
import { ASSISTANT_SYSTEM_PROMPT } from "@workspace/ai/prompts/assistant-system";

await generateText({
  model: getModel(),
  system: ASSISTANT_SYSTEM_PROMPT,
  prompt: payload.text,
  ...getGenerationDefaults(),
  ...buildTelemetryOptions({ functionId: "ai.example" }),
});
```

Log result length (no persistence).

- [ ] **Step 3:** Mock `@workspace/ai` in test; assert `generateText` called once.

- [ ] **Step 4: Commit** `feat(workers): ai example handler`

---

### Task 15: promptfoo eval scaffold

**Files:**
- Create: `evals/promptfoo/promptfooconfig.yaml`
- Create: `evals/promptfoo/prompts/assistant-system.txt`
- Create: `evals/promptfoo/tests/golden.yaml`
- Modify: root `package.json` — `"eval:ai": "dotenv -- npx promptfoo@latest eval -c evals/promptfoo/promptfooconfig.yaml"`

- [ ] **Step 1:** Config with one provider pointing at env (`OPENROUTER_API_KEY` or `OPENAI_API_KEY`), 2–3 golden assertions (e.g. response mentions “assistant” role, max length).

- [ ] **Step 2:** Copy prompt text from `packages/ai/src/prompts/assistant-system.ts` into `prompts/assistant-system.txt` (add comment in plan to keep in sync).

- [ ] **Step 3:** Document in README — evals are optional CI, require API key.

- [ ] **Step 4: Commit** `chore(evals): promptfoo scaffold for assistant prompt`

---

### Task 16: Final verification

- [ ] **Step 1:** `pnpm type-check`

- [ ] **Step 2:** `pnpm lint`

- [ ] **Step 3:** `pnpm test --filter @workspace/ai --filter @workspace/ai-chat --filter @workspace/common`

- [ ] **Step 4:** `pnpm test --filter dashboard --filter workers`

- [ ] **Step 5:** Manual checklist from spec (stream chat, MCP tool card, reload thread, feedback, worker handler with AI env set)

- [ ] **Step 6: Commit** any fixups — `chore: ai package verification pass`

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `packages/ai` factory + agent | 5–8 |
| `packages/ai-chat` repos | 3–4 |
| `ai.prisma` | 2 |
| Dashboard MCP loop | 10–13 |
| Workers `generateText` | 14 |
| Env + README | 9 |
| Langfuse optional | 7, 12 |
| promptfoo | 15 |
| Feedback UI | 4, 13 |
| Critical tests | 1–4, 6, 8, 10 |
| No billing gate | (none — omit entitlements) |

---

## Verification

- `pnpm type-check`
- `pnpm lint`
- `pnpm test --filter @workspace/ai --filter @workspace/ai-chat`
- `pnpm test --filter dashboard --filter workers`
- `pnpm eval:ai` (optional; requires API key)
