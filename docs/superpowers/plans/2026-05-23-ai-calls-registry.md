# AI Calls Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `@workspace/ai` into `platform/` + `ai-calls/<name>/` vertical slices (prompt.md + command module), add Mustache variable injection, merge `@workspace/ai-chat` persistence into `assistant-chat`, and wire dashboard/worker through named call commands.

**Architecture:** Each named LLM use case lives in `packages/ai/src/ai-calls/<name>/` with `prompt.md` (editable copy) and `<name>.ts` (Zod variables, `defineAiCall` config, public command). Shared SDK plumbing moves to `platform/` including new `render-prompt.ts` and `ask-ai.ts`. Apps assemble variables and call `askAssistantChat()` / `runWorkerExample()` — never `streamText` directly. Model catalog/presets from the **already-implemented** catalog plan stay; files move under `platform/models/`.

**Tech Stack:** Vercel AI SDK v6, Mustache, Zod, Vitest, promptfoo (evals). Existing catalog: `AI_CALL_PRESETS`, `resolveProviderModel`, `logAiCall`.

**Design spec:** [`docs/superpowers/specs/2026-05-23-ai-calls-registry-design.md`](../specs/2026-05-23-ai-calls-registry-design.md)

**Prerequisite (do NOT re-implement):** [`2026-05-23-ai-models-catalog-and-selector.md`](./2026-05-23-ai-models-catalog-and-selector.md) — verified shipped.

---

## File map

| File | Action |
|------|--------|
| `packages/ai/src/platform/render-prompt.ts` | Create — Mustache render + placeholder validation |
| `packages/ai/src/platform/render-prompt.test.ts` | Create |
| `packages/ai/src/platform/define-ai-call.ts` | Create — call registry types + factory |
| `packages/ai/src/platform/define-ai-call.test.ts` | Create |
| `packages/ai/src/platform/ask-ai.ts` | Create — unified stream/generate/agent executor |
| `packages/ai/src/platform/ask-ai.test.ts` | Create |
| `packages/ai/src/platform/extract-template-vars.ts` | Create — parse `{{var}}` / `{{#var}}` from prompt text |
| `packages/ai/src/platform/models/ai-models-available.ts` | Move from `src/ai-models-available.ts` |
| `packages/ai/src/platform/*.ts` | Move existing platform files (get-model, resolve-*, log-ai-call, etc.) |
| `packages/ai/src/ai-calls/assistant-chat/prompt.md` | Create — migrate from `prompts/assistant-system.ts` |
| `packages/ai/src/ai-calls/assistant-chat/assistant-chat.ts` | Create |
| `packages/ai/src/ai-calls/assistant-chat/assistant-chat.test.ts` | Create |
| `packages/ai/src/ai-calls/assistant-chat/persistence.ts` | Create — merge from `@workspace/ai-chat` repos |
| `packages/ai/src/ai-calls/assistant-chat/persistence.test.ts` | Move from `packages/ai-chat` |
| `packages/ai/src/ai-calls/assistant-chat/schemas.ts` | Create — from `ai-chat-schemas.ts` |
| `packages/ai/src/ai-calls/worker-example/prompt.md` | Create |
| `packages/ai/src/ai-calls/worker-example/worker-example.ts` | Create |
| `packages/ai/src/ai-calls/worker-example/worker-example.test.ts` | Create |
| `packages/ai/src/ai-calls/index.ts` | Create — registry barrel |
| `packages/ai/src/index.ts` | Modify — re-export platform + ai-calls |
| `packages/ai/package.json` | Modify — exports, add `mustache`, add `@workspace/database` |
| `packages/ai/src/prompts/assistant-system.ts` | Delete |
| `packages/ai-chat/` | Delete entire package after migration |
| `apps/dashboard/app/api/ai/chat/route.ts` | Modify — thin wrapper around `askAssistantChat` |
| `apps/workers/src/handlers/ai-example.ts` | Modify — use `runWorkerExample` |
| `evals/promptfoo/` | Modify — per-call configs pointing at `prompt.md` |
| `packages/ai/README.md` | Update |

---

## Critical Tests

- `packages/ai/src/platform/render-prompt.test.ts`: Mustache substitutes vars; optional sections omitted when var absent; throws on unresolved `{{` after render.
- `packages/ai/src/platform/extract-template-vars.test.ts`: extracts `orgName`, `toolSummary` from sample prompt; ignores Mustache comments.
- `packages/ai/src/platform/ask-ai.test.ts`: stream mode calls mocked `streamText` with rendered system + preset params; logs `functionId`; rejects invalid variables.
- `packages/ai/src/ai-calls/assistant-chat/assistant-chat.test.ts`: prompt placeholders match Zod schema keys; `askAssistantChat` forwards `providerModel` override; mocked SDK receives rendered `orgName`.
- `packages/ai/src/ai-calls/worker-example/worker-example.test.ts`: generate mode uses worker preset; validates `inputText`.
- `packages/ai/src/ai-calls/assistant-chat/persistence.test.ts`: migrated repo tests pass unchanged (org/user scoping, append ordering, feedback).

---

### Task 1: Add Mustache + `render-prompt` (TDD)

**Files:**
- Create: `packages/ai/src/platform/render-prompt.ts`
- Create: `packages/ai/src/platform/render-prompt.test.ts`
- Create: `packages/ai/src/platform/extract-template-vars.ts`
- Create: `packages/ai/src/platform/extract-template-vars.test.ts`
- Modify: `packages/ai/package.json` — add `"mustache": "^4"`

- [ ] **Step 1:** Add `mustache` dependency (`pnpm add mustache --filter @workspace/ai` — ask user if needed per workspace rules; document in plan).

- [ ] **Step 2:** Write failing tests for `extractTemplateVars`:
  - `"Hello {{orgName}}"` → `["orgName"]`
  - `"{{#toolSummary}}x{{/toolSummary}}"` → `["toolSummary"]`

- [ ] **Step 3:** Implement `extractTemplateVars(template: string): string[]`.

- [ ] **Step 4:** Write failing tests for `renderPrompt(template, variables)`:
  - substitutes `{{orgName}}`
  - omits `{{#toolSummary}}` block when undefined
  - throws if rendered output still contains `{{`

- [ ] **Step 5:** Implement `renderPrompt` using Mustache.

- [ ] **Step 6:** Run `pnpm test --filter @workspace/ai -- render-prompt extract-template-vars`.

- [ ] **Step 7:** Commit: `feat(ai): add Mustache prompt rendering`

---

### Task 2: `defineAiCall` factory (TDD)

**Files:**
- Create: `packages/ai/src/platform/define-ai-call.ts`
- Create: `packages/ai/src/platform/define-ai-call.test.ts`

- [ ] **Step 1:** Define types:

```typescript
export type AiCallMode = "stream" | "generate" | "agent";

export interface DefinedAiCall<TVariables extends z.ZodType = z.ZodType> {
  id: string;
  dir: string;           // absolute path to call folder (for resolving prompt.md)
  promptFile: string;    // e.g. "prompt.md"
  preset: AiCallPresetName;
  mode: AiCallMode;
  variables: TVariables;
  presetOverrides?: Partial<AiCallPreset>;
}

export function defineAiCall<T extends z.ZodType>(config: {
  id: string;
  prompt: string;
  preset: AiCallPresetName;
  mode: AiCallMode;
  variables: T;
  presetOverrides?: Partial<AiCallPreset>;
}): DefinedAiCall<T>;
```

Use `import.meta.url` / `fileURLToPath` to resolve `dir` from the calling module.

- [ ] **Step 2:** Test: `defineAiCall` from a test fixture folder resolves `prompt.md` path correctly.

- [ ] **Step 3:** Implement `defineAiCall`.

- [ ] **Step 4:** Add helper `loadCallPrompt(call: DefinedAiCall): string` (reads prompt file from disk).

- [ ] **Step 5:** Commit: `feat(ai): defineAiCall factory`

---

### Task 3: Move existing files to `platform/` (no behavior change)

**Files:**
- Move: `src/ai-models-available.ts` → `src/platform/models/ai-models-available.ts`
- Move: all other `src/*.ts` platform files → `src/platform/` (except new ai-calls)
- Move: associated `*.test.ts` files
- Modify: all internal imports within `packages/ai`
- Modify: `packages/ai/package.json` exports paths
- Modify: `@workspace/ai` consumers importing moved paths (grep repo)

- [ ] **Step 1:** Move files; update relative imports inside package.

- [ ] **Step 2:** Update `package.json` exports:

```json
"./ai-models-available": "./src/platform/models/ai-models-available.ts",
"./list-available-ai-models": "./src/platform/list-available-ai-models.ts",
"./resolve-provider-model": "./src/platform/resolve-provider-model.ts"
```

- [ ] **Step 3:** Grep monorepo for `@workspace/ai` imports — update if any broke (dashboard, workers should still work via barrel or unchanged export paths).

- [ ] **Step 4:** Run `pnpm test --filter @workspace/ai` — all existing tests green.

- [ ] **Step 5:** Run `pnpm type-check`.

- [ ] **Step 6:** Commit: `refactor(ai): move shared infra to platform/`

---

### Task 4: `ask-ai` executor (TDD)

**Files:**
- Create: `packages/ai/src/platform/ask-ai.ts`
- Create: `packages/ai/src/platform/ask-ai.test.ts`

- [ ] **Step 1:** Mock `ai` SDK (`streamText`, `generateText`) and platform deps (`getModel`, `logAiCall`, etc.).

- [ ] **Step 2:** Write failing test: `askAi` in stream mode:
  - validates variables
  - renders system prompt
  - calls `resolveAiCallOptions` with preset + overrides
  - calls `streamText` with `stopWhen: stepCountIs(preset.maxSteps)`, `getGenerationParams`, telemetry
  - calls `logAiCall({ functionId: call.id, ... })`

- [ ] **Step 3:** Write failing test: generate mode uses `generateText` with `prompt` arg.

- [ ] **Step 4:** Implement `askAi` for `stream` and `generate` modes.

- [ ] **Step 5:** Wire `agent` mode to existing `runAgent` (or defer if assistant-chat uses stream directly — **use stream mode for assistant-chat** to preserve current `streamText` + `toUIMessageStreamResponse` behavior).

- [ ] **Step 6:** Run tests; commit: `feat(ai): askAi unified executor`

---

### Task 5: `assistant-chat` call slice (TDD)

**Files:**
- Create: `packages/ai/src/ai-calls/assistant-chat/prompt.md`
- Create: `packages/ai/src/ai-calls/assistant-chat/assistant-chat.ts`
- Create: `packages/ai/src/ai-calls/assistant-chat/assistant-chat.test.ts`
- Delete (later task): `packages/ai/src/prompts/assistant-system.ts`

- [ ] **Step 1:** Create `prompt.md` — port content from `ASSISTANT_SYSTEM_PROMPT`, add `{{orgName}}` and optional `{{#toolSummary}}` block. Keep guidelines concise.

- [ ] **Step 2:** Write failing tests:
  - `extractTemplateVars(prompt) === Object.keys(variables.shape)`
  - render with fixtures
  - `askAssistantChat` mocked — verify `askAi` called with correct call + variables

- [ ] **Step 3:** Implement `assistant-chat.ts`:

```typescript
export const variables = z.object({
  orgName: z.string().min(1),
  toolSummary: z.string().optional(),
});

export const call = defineAiCall({
  id: "assistant-chat",
  prompt: "./prompt.md",
  preset: "assistant",
  mode: "stream",
  variables,
});

export async function askAssistantChat(input: {
  messages: ModelMessage[];
  tools: ToolSet;
  variables: z.infer<typeof variables>;
  overrides?: { providerModel?: ProviderModelValue };
  context: { userId: string; orgId: string; sessionId?: string };
  onFinish?: (result: { text: string; steps: unknown[] }) => Promise<void>;
}): Promise<ReturnType<typeof streamText>> {
  return askAi(call, input);
}
```

- [ ] **Step 4:** Export from `package.json`: `"./ai-calls/assistant-chat": "..."`.

- [ ] **Step 5:** Tests pass; commit: `feat(ai): assistant-chat call slice`

---

### Task 6: Merge `@workspace/ai-chat` into `assistant-chat/persistence`

**Files:**
- Create: `packages/ai/src/ai-calls/assistant-chat/persistence.ts`
- Create: `packages/ai/src/ai-calls/assistant-chat/schemas.ts`
- Create: `packages/ai/src/ai-calls/assistant-chat/persistence.test.ts` (move tests)
- Modify: `packages/ai/package.json` — add `@workspace/database`
- Modify: all `@workspace/ai-chat` imports in monorepo
- Delete: `packages/ai-chat/`

- [ ] **Step 1:** Copy `ai-thread-repo.ts`, `ai-message-repo.ts` into `persistence.ts` (or two files if too large — prefer one `persistence.ts` exporting all repo functions).

- [ ] **Step 2:** Copy `ai-chat-schemas.ts` → `schemas.ts`.

- [ ] **Step 3:** Move colocated tests; fix imports.

- [ ] **Step 4:** Update dashboard imports:
  - `@workspace/ai-chat` → `@workspace/ai/ai-calls/assistant-chat/persistence` (or re-export from `assistant-chat.ts`)
  - `@workspace/ai-chat/schemas/ai-chat-schemas` → `@workspace/ai/ai-calls/assistant-chat/schemas`

- [ ] **Step 5:** Remove `packages/ai-chat` from workspace (`pnpm-workspace.yaml` if listed, turbo, dashboard deps).

- [ ] **Step 6:** Run `pnpm test --filter @workspace/ai --filter dashboard`.

- [ ] **Step 7:** Commit: `refactor(ai): merge ai-chat persistence into assistant-chat`

---

### Task 7: `worker-example` call slice (TDD)

**Files:**
- Create: `packages/ai/src/ai-calls/worker-example/prompt.md`
- Create: `packages/ai/src/ai-calls/worker-example/worker-example.ts`
- Create: `packages/ai/src/ai-calls/worker-example/worker-example.test.ts`

- [ ] **Step 1:** Write `prompt.md` — short worker system prompt (not assistant prompt). Template var: `{{inputText}}` or static system + user prompt in generate mode.

**Recommendation:** static system prompt in `prompt.md` (no vars) + pass `payload.text` as generate `prompt` arg. Variables schema can be empty or `{ inputText: z.string() }` for validation only.

- [ ] **Step 2:** Implement `runWorkerExample({ variables: { inputText } })` using `askAi` generate mode.

- [ ] **Step 3:** Tests + commit: `feat(ai): worker-example call slice`

---

### Task 8: Refactor dashboard chat route

**Files:**
- Modify: `apps/dashboard/app/api/ai/chat/route.ts`
- Modify: `apps/dashboard/features/ai-chat/data/ai-chat-actions.ts` (import paths)

- [ ] **Step 1:** Replace direct `streamText` + `ASSISTANT_SYSTEM_PROMPT` with:

```typescript
import { askAssistantChat } from "@workspace/ai/ai-calls/assistant-chat";
import { getOrCreateActiveThread, ... } from "@workspace/ai/ai-calls/assistant-chat/persistence";

// Build variables from org context + MCP tools
const variables = {
  orgName: org.name, // fetch org or pass from session context
  toolSummary: formatToolSummary(mcpTools),
};

const result = await askAssistantChat({
  messages: modelMessages,
  tools,
  variables,
  overrides: { providerModel: resolved.providerModel },
  context: { userId, orgId: activeOrganizationId, sessionId: thread.id },
  onFinish: async ({ text, steps }) => { /* existing persist logic */ },
});

return result.toUIMessageStreamResponse();
```

- [ ] **Step 2:** Remove duplicate `logAiCall` / `resolveAiCallOptions` / `getModel` from route (handled inside `askAi`).

- [ ] **Step 3:** Add helper `formatToolSummary` in dashboard feature (not in `@workspace/ai`).

- [ ] **Step 4:** Manual test: chat streams, model selector works, refresh restores thread.

- [ ] **Step 5:** Commit: `refactor(dashboard): chat route uses askAssistantChat`

---

### Task 9: Refactor worker handler

**Files:**
- Modify: `apps/workers/src/handlers/ai-example.ts`
- Modify: `apps/workers/src/handlers/ai-example.test.ts`

- [ ] **Step 1:** Replace manual `generateText` assembly with `runWorkerExample({ variables: { inputText: payload.text } })`.

- [ ] **Step 2:** Update mocks in test.

- [ ] **Step 3:** Commit: `refactor(workers): use runWorkerExample call`

---

### Task 10: Cleanup deprecated paths

**Files:**
- Delete: `packages/ai/src/prompts/assistant-system.ts`
- Modify: `packages/ai/src/index.ts` — remove `ASSISTANT_SYSTEM_PROMPT` export
- Modify: `packages/ai/package.json` — remove `./prompts/assistant-system`
- Create: `packages/ai/src/ai-calls/index.ts`

- [ ] **Step 1:** Grep for `ASSISTANT_SYSTEM_PROMPT` and `@workspace/ai/prompts/assistant-system` — remove/replace.

- [ ] **Step 2:** Add `ai-calls/index.ts` registry:

```typescript
export { call as assistantChatCall, askAssistantChat, variables as assistantChatVariables } from "./assistant-chat/assistant-chat";
export { call as workerExampleCall, runWorkerExample } from "./worker-example/worker-example";

export const AI_CALLS = { "assistant-chat": assistantChatCall, "worker-example": workerExampleCall } as const;
```

- [ ] **Step 3:** Update `packages/ai/README.md` — document `ai-calls/` layout, prompt editing, testing.

- [ ] **Step 4:** Commit: `chore(ai): remove deprecated assistant-system prompt path`

---

### Task 11: promptfoo evals per call

**Files:**
- Create: `evals/promptfoo/assistant-chat/promptfooconfig.yaml`
- Create: `evals/promptfoo/assistant-chat/tests/golden.yaml`
- Modify: root `package.json` `eval:ai` script (or document running both)
- Delete or redirect: `evals/promptfoo/prompts/assistant-system.txt`

- [ ] **Step 1:** Point prompt at source file:

```yaml
prompts:
  - id: assistant-chat-system
    file: file://../../../packages/ai/src/ai-calls/assistant-chat/prompt.md
    suffix: "\n\nUser: {{question}}"

defaultTest:
  vars:
    orgName: "Acme Corp"
    toolSummary: "- account-info"
```

- [ ] **Step 2:** Port golden tests from `evals/promptfoo/tests/golden.yaml`.

- [ ] **Step 3:** Remove duplicate `evals/promptfoo/prompts/assistant-system.txt` and sync comment.

- [ ] **Step 4:** Document `pnpm eval:ai` in README.

- [ ] **Step 5:** Commit: `chore(evals): promptfoo points at ai-calls prompt.md`

---

### Task 12: Verification

- [ ] `pnpm type-check`
- [ ] `pnpm lint`
- [ ] `pnpm test --filter @workspace/ai`
- [ ] `pnpm test --filter dashboard`
- [ ] `pnpm test --filter workers`
- [ ] Manual: AI Assistant — model selector, stream, MCP tool, refresh thread
- [ ] Manual: worker `ai.example` job runs (or skips gracefully without OpenAI key)
- [ ] Optional: `pnpm eval:ai` with API key

- [ ] Commit any fixups: `chore: ai-calls registry verification`

---

## Optional follow-up (out of scope)

- ESLint rule: forbid `streamText` / `generateText` imports outside `packages/ai`
- `AiThread.preferredProviderModel` column
- Additional `ai-calls/*` slices (summarize, suggest-tags, etc.)
- promptfoo CI GitHub Action on `prompt.md` changes

---

## Verification

- `pnpm type-check`
- `pnpm lint`
- `pnpm test --filter @workspace/ai`
- `pnpm test --filter dashboard`
