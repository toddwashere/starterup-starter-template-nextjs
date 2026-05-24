# AI Calls Registry (`ai-calls/`)

**Date:** 2026-05-23  
**Status:** Approved  
**Supersedes (partially):** [`2026-05-23-ai-package-design.md`](./2026-05-23-ai-package-design.md) — sections on package layout, prompts, and `@workspace/ai-chat`  
**Prerequisite (implemented):** [`2026-05-23-ai-models-catalog-and-selector.md`](../plans/2026-05-23-ai-models-catalog-and-selector.md) — model catalog, presets, selector, server validation

## Overview

Centralize every LLM invocation in `@workspace/ai` as **named AI calls** under `ai-calls/<name>/`. Each call is a vertical slice: an editable `prompt.md` (with `{{variable}}` placeholders) and one TypeScript module (`<name>.ts`) for the variable schema, call config, and public command function.

Non-engineers edit prompts and documented placeholders; engineers wire variable sources in apps. All LLM execution flows through `platform/ask-ai.ts` — apps do not call `streamText` / `generateText` directly.

This spec also **merges `@workspace/ai-chat`** into `@workspace/ai` as `ai-calls/assistant-chat/persistence.ts` (thread/message repos scoped to the assistant chat call).

---

## Verified baseline (already shipped)

The models catalog plan is **fully implemented**. Do not re-implement:

| Area | Status | Key paths |
|------|--------|-----------|
| Model catalog + presets | ✅ | `packages/ai/src/ai-models-available.ts` |
| Env key filtering | ✅ | `packages/ai/src/list-available-ai-models.ts` |
| Server allowlist validation | ✅ | `packages/ai/src/resolve-provider-model.ts` |
| Preset resolution | ✅ | `packages/ai/src/resolve-ai-call-options.ts` |
| Generation params | ✅ | `packages/ai/src/get-generation-params.ts` |
| Call logging | ✅ | `packages/ai/src/log-ai-call.ts` |
| `getModel({ providerModel \| preset })` | ✅ | `packages/ai/src/get-model.ts` |
| Env cleanup (no `AI_PROVIDER` / `AI_MODEL`) | ✅ | `packages/ai/keys.ts`, `.env.example` |
| Dashboard model selector | ✅ | `AiProviderModelSelect`, `listAvailableAiModelsAction` |
| Chat route validation | ✅ | `apps/dashboard/app/api/ai/chat/route.ts` |
| Worker preset usage | ✅ | `apps/workers/src/handlers/ai-example.ts` |

**Gap this spec closes:** call sites still assemble prompts, SDK calls, and logging manually. Prompts live in a `.ts` string (`prompts/assistant-system.ts`). `@workspace/ai-chat` is a separate package. No variable injection or per-call test contract.

---

## Decisions

| Topic | Decision |
|-------|----------|
| **Layout** | `packages/ai/src/ai-calls/<name>/` — one folder per named call |
| **Files per call** | `prompt.md` + `<name>.ts` (+ colocated `.test.ts`; optional `persistence.ts` for chat) |
| **Shared infra** | `packages/ai/src/platform/` — models, SDK plumbing, `defineAiCall`, `renderPrompt`, `askAi` |
| **Presets** | Keep `AI_CALL_PRESETS` in `platform/models/ai-models-available.ts` — calls reference by name |
| **Template engine** | Mustache (logic-less `{{var}}`, `{{#section}}…{{/section}}`) |
| **Variable contract** | Zod schema in `<name>.ts`; CI test that placeholders match schema |
| **App boundary** | Apps build `variables` (from auth/org/MCP); calls validate + render only |
| **Tools** | Injected by caller — not declared in `prompt.md` |
| **Persistence** | `ai-calls/assistant-chat/persistence.ts` — merge from `@workspace/ai-chat`; remove package |
| **Public API** | Named functions (`askAssistantChat`, `runWorkerExample`) — not string dispatch from apps |
| **Evals** | promptfoo per call, pointing at source `prompt.md` (no duplicate `.txt`) |

---

## Architecture

```text
packages/ai/src/
  platform/
    models/
      ai-models-available.ts     ← catalog + AI_CALL_PRESETS (moved)
    define-ai-call.ts            ← call registry factory + types
    render-prompt.ts             ← Mustache + placeholder validation
    ask-ai.ts                    ← stream / generate / agent dispatch
    get-model.ts
    resolve-provider-model.ts
    resolve-ai-call-options.ts
    get-generation-params.ts
    list-available-ai-models.ts
    log-ai-call.ts
    telemetry.ts
    run-agent.ts
    provider-configured.ts

  ai-calls/
    assistant-chat/
      prompt.md
      assistant-chat.ts          ← variables, call def, askAssistantChat()
      assistant-chat.test.ts
      persistence.ts             ← AiThread / AiMessage repos (from ai-chat)
      persistence.test.ts
    worker-example/
      prompt.md
      worker-example.ts
      worker-example.test.ts
    index.ts                     ← registry barrel

  index.ts                       ← re-exports platform + ai-calls
```

```text
apps/dashboard/app/api/ai/chat/route.ts
  auth → thread persistence → build variables → askAssistantChat()
apps/workers/handlers/ai-example.ts
  runWorkerExample({ variables: { inputText } })
```

### Separation of concerns

| Layer | Responsibility |
|-------|----------------|
| **`ai-calls/<name>/prompt.md`** | Editable copy + Mustache placeholders |
| **`ai-calls/<name>/<name>.ts`** | Zod variables, preset/mode/id, public command |
| **`platform/`** | Model catalog, prompt render, SDK execution, telemetry |
| **`ai-calls/assistant-chat/persistence.ts`** | Thread/message Postgres repos |
| **Dashboard feature** | Auth, MCP tools, variable assembly, HTTP route, UI |

---

## AI call module contract

Each `ai-calls/<name>/<name>.ts` exports:

```typescript
export const variables: z.ZodObject<...>;     // prompt variable contract
export const call: DefinedAiCall;              // from defineAiCall()
export async function askXxx(input: {...}): Promise<...>;
```

`defineAiCall` config:

```typescript
{
  id: string;                    // e.g. "assistant-chat" — used as functionId for logging
  prompt: "./prompt.md";         // relative to call folder
  preset: AiCallPresetName;      // from AI_CALL_PRESETS
  mode: "stream" | "generate" | "agent";
  variables: z.ZodObject<...>;
  presetOverrides?: Partial<AiCallPreset>;  // rare; code review only
}
```

### Variable injection

1. Caller passes plain `variables` object (validated by Zod).
2. `renderPrompt(call, variables)` loads `prompt.md`, runs Mustache, rejects unresolved `{{placeholders}}`.
3. Rendered string becomes the `system` prompt passed to the SDK.

**Example placeholders** (`assistant-chat/prompt.md`):

```markdown
You are a helpful assistant for {{orgName}}.
...
{{#toolSummary}}
Available tools:
{{toolSummary}}
{{/toolSummary}}
```

**Example schema** (`assistant-chat.ts`):

```typescript
export const variables = z.object({
  orgName: z.string().min(1),
  toolSummary: z.string().optional(),
});
```

Apps format complex data before injection (e.g. `formatToolList(mcpTools)` → `toolSummary` string).

---

## `askAi` platform executor

Single entry for SDK calls. Used by all call commands internally.

```typescript
// platform/ask-ai.ts — conceptual API
export async function askAi(
  call: DefinedAiCall,
  input: {
    messages?: ModelMessage[];
    prompt?: string;              // generate mode user prompt
    tools?: ToolSet;
    variables: Record<string, unknown>;
    overrides?: { providerModel?: ProviderModelValue };
    context?: { userId?: string; orgId?: string; sessionId?: string };
    onFinish?: (result: ...) => Promise<void>;
  },
): Promise<StreamTextResult | GenerateTextResult>;
```

Behavior:

1. Validate `variables` with call's Zod schema.
2. `resolveAiCallOptions({ preset, overrides })` + `resolveProviderModel` when `providerModel` override present.
3. `renderPrompt` → system string.
4. `logAiCall({ functionId: call.id, providerModel, ...context })`.
5. Dispatch by `mode`: `streamText` / `generateText` / `runAgent`.
6. Attach `buildTelemetryOptions` + `getGenerationParams`.

---

## Call definitions (v1)

### `assistant-chat`

| Field | Value |
|-------|-------|
| `id` | `assistant-chat` |
| `preset` | `assistant` |
| `mode` | `stream` |
| Variables | `orgName`, optional `toolSummary` |
| Command | `askAssistantChat()` |
| Persistence | `persistence.ts` — thread/message repos |

Dashboard route passes `overrides.providerModel` from UI selector. Route retains auth, thread CRUD, MCP tool wiring, and `onFinish` persistence.

### `worker-example`

| Field | Value |
|-------|-------|
| `id` | `worker-example` |
| `preset` | `worker` |
| `mode` | `generate` |
| Variables | `inputText` |
| Command | `runWorkerExample()` |

Replaces incorrect reuse of `ASSISTANT_SYSTEM_PROMPT` in the worker handler.

---

## Merge `@workspace/ai-chat`

Move into `ai-calls/assistant-chat/`:

- `persistence.ts` — `ai-thread-repo` + `ai-message-repo` functions
- `schemas.ts` — feedback Zod schemas (from `ai-chat-schemas.ts`)
- Colocated tests

Update imports:

- `@workspace/ai-chat` → `@workspace/ai/ai-calls/assistant-chat` (persistence + schemas)
- Delete `packages/ai-chat/`

Add `@workspace/database` to `packages/ai/package.json` dependencies.

Remove deprecated:

- `packages/ai/src/prompts/assistant-system.ts`
- export `./prompts/assistant-system` from `package.json`

---

## Package exports

```json
{
  ".": "./src/index.ts",
  "./keys": "./keys.ts",
  "./ai-models-available": "./src/platform/models/ai-models-available.ts",
  "./list-available-ai-models": "./src/platform/list-available-ai-models.ts",
  "./resolve-provider-model": "./src/platform/resolve-provider-model.ts",
  "./ai-calls/assistant-chat": "./src/ai-calls/assistant-chat/assistant-chat.ts",
  "./ai-calls/worker-example": "./src/ai-calls/worker-example/worker-example.ts",
  "./ai-calls": "./src/ai-calls/index.ts"
}
```

Backward-compat shim (optional, one release): re-export persistence from `./ai-calls/assistant-chat/persistence.ts` if needed.

---

## Testing strategy

### Layer 1 — Vitest (CI always, no API keys)

Per call (`assistant-chat.test.ts`):

- Renders `prompt.md` with fixture variables; no leftover `{{placeholders}}`
- **Contract test:** Mustache vars in prompt match Zod schema keys
- Command calls mocked `askAi` / SDK with correct preset, `functionId`, rendered system string
- Rejects invalid variables before SDK invocation

Platform (`platform/render-prompt.test.ts`):

- Mustache rendering, missing required vars, unresolved placeholder detection

Persistence (`persistence.test.ts`):

- Existing repo tests migrated unchanged (org/user scoping, feedback rules)

### Layer 2 — promptfoo (prompt quality, optional API key)

```text
evals/promptfoo/
  assistant-chat/
    promptfooconfig.yaml    ← points at packages/ai/src/ai-calls/assistant-chat/prompt.md
    tests/golden.yaml
  worker-example/
    promptfooconfig.yaml
    tests/golden.yaml
```

Root `pnpm eval:ai` runs all call eval configs. CI triggers on `ai-calls/**/prompt.md` changes.

---

## Critical Tests

- `packages/ai/src/platform/render-prompt.test.ts`: Mustache render; throws on missing required vars; rejects unresolved `{{` placeholders.
- `packages/ai/src/platform/define-ai-call.test.ts`: `defineAiCall` registers id, resolves prompt path relative to call folder.
- `packages/ai/src/ai-calls/assistant-chat/assistant-chat.test.ts`: prompt placeholders match Zod schema; `askAssistantChat` uses assistant preset + rendered system; invalid `orgName` rejected before SDK.
- `packages/ai/src/ai-calls/worker-example/worker-example.test.ts`: generate mode + worker preset; `inputText` appears in rendered prompt or generate prompt arg.
- `packages/ai/src/ai-calls/assistant-chat/persistence.test.ts`: migrated thread/message repo tests (org scoping, feedback).
- `apps/dashboard/app/api/ai/chat/route.test.ts` (optional): route delegates to `askAssistantChat`; 400 on invalid model unchanged.

---

## Out of scope (v1)

- Admin UI for editing prompts
- DB-stored prompts
- Tools declared in YAML/prompt files
- `executeAiCall(id)` string dispatch from app code (registry is for introspection/evals only)
- Additional AI calls beyond `assistant-chat` and `worker-example`

---

## Verification

- `pnpm type-check`
- `pnpm lint`
- `pnpm test --filter @workspace/ai`
- `pnpm test --filter dashboard`
- Manual: AI Assistant streams with model selector; prompt edits in `prompt.md` reflected after restart
- Optional: `pnpm eval:ai` with `OPENROUTER_API_KEY` set

---

## References

- Implemented catalog: [`2026-05-23-ai-models-catalog-and-selector.md`](../plans/2026-05-23-ai-models-catalog-and-selector.md)
- Original AI package spec: [`2026-05-23-ai-package-design.md`](./2026-05-23-ai-package-design.md)
- Colocated tests: [`.ai/conventions/colocated-tests.md`](../../../.ai/conventions/colocated-tests.md)
