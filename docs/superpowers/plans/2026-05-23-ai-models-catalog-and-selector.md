# AI Models Catalog & Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace env-based `AI_PROVIDER` / `AI_MODEL` routing with a central code catalog (`ai-models-available.ts`), runtime filtering by configured API keys, server allowlist validation, named presets for workers, and a dashboard provider+model selector wired into AI Assistant chat.

**Architecture:** Full model list lives in `@workspace/ai`; only models whose provider has credentials in env are exposed at runtime. Call sites pass `providerModel` (`"openrouter:anthropic/claude-sonnet-4"`) or a preset key. Chat UI loads available options via a server action; each message sends the selected value to `/api/ai/chat`, which validates before `getModel()`. See [`docs/superpowers/specs/2026-05-23-ai-package-design.md`](../specs/2026-05-23-ai-package-design.md) (Model catalog section).

**Prerequisite:** Base AI stack from [`2026-05-23-ai-package.md`](./2026-05-23-ai-package.md) is implemented (`@workspace/ai`, `@workspace/ai-chat`, chat route, MCP loop).

**Tech Stack:** Existing Vercel AI SDK setup; no new provider packages required.

---

## Decisions (this plan)

| Topic | Decision |
|-------|----------|
| **Catalog file** | `packages/ai/src/ai-models-available.ts` (not `chat-models.ts`) |
| **Encoding** | `provider:modelId` string (Bloomlogic-style) |
| **Env routing** | Remove `AI_PROVIDER` / `AI_MODEL`; keys + optional globals only |
| **Availability** | `getAvailableAiModels(keys())` filters catalog by configured keys |
| **Server validation** | `resolveProviderModel(value)` allowlists against full catalog |
| **Presets** | `AI_MODEL_PRESETS.assistant`, `.worker` → catalog values |
| **Ollama** | Include when `OLLAMA_BASE_URL` set (default localhost URL counts as configured) |
| **UI** | `AiProviderModelSelect` in `features/ai-chat/ui/`; options from server action |
| **Chat transport** | Pass `providerModel` on each POST to `/api/ai/chat` |
| **Thread persistence** | v1: client state + refresh from action default; optional v1.1: `AiThread.preferredProviderModel` |

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/ai/src/ai-models-available.ts` | Full catalog, labels, parse/to, presets (client-safe constants) |
| `packages/ai/src/list-available-ai-models.ts` | Filter catalog by `keys()` (server) |
| `packages/ai/src/resolve-provider-model.ts` | Allowlist parse + resolve to `{ provider, modelId }` |
| `packages/ai/src/get-model.ts` | **Modify** — `getModel({ providerModel?, preset? })` |
| `packages/ai/keys.ts` | **Modify** — remove `AI_PROVIDER`, `AI_MODEL` |
| `packages/ai/src/run-agent.ts` | **Modify** — pass model options through |
| `apps/dashboard/features/ai-chat/data/ai-chat-actions.ts` | `listAvailableAiModelsAction`, extend load thread |
| `apps/dashboard/features/ai-chat/ui/ai-provider-model-select.tsx` | Grouped select component |
| `apps/dashboard/features/ai-chat/ui/ai-chat-page-content.tsx` | Selector + transport body |
| `apps/dashboard/app/api/ai/chat/route.ts` | Read + validate `providerModel` from body |
| `apps/workers/src/handlers/ai-example.ts` | `getModel({ preset: "worker" })` |
| `.env.example`, `packages/ai/README.md` | Document catalog + keys-only env |

---

## Critical Tests

- `packages/ai/src/ai-models-available.test.ts`: `parseProviderModelValue` / `toProviderModelValue`; invalid strings return null.
- `packages/ai/src/list-available-ai-models.test.ts`: with only `OPENROUTER_API_KEY` stubbed, openrouter models present, anthropic direct absent.
- `packages/ai/src/resolve-provider-model.test.ts`: rejects catalog miss; rejects provider without key.
- `packages/ai/src/get-model.test.ts`: **rewrite** — `getModel({ providerModel: "openrouter:..." })` and `getModel({ preset: "assistant" })`; no `AI_PROVIDER` env.
- `apps/dashboard/features/ai-chat/data/list-available-ai-models.test.ts` (or action test): returns only configured providers.
- `apps/dashboard/app/api/ai/chat/route.test.ts` (optional): 400 on invalid `providerModel`, 503 when no keys configured.

---

### Task 1: `ai-models-available.ts` catalog (TDD)

**Files:**
- Create: `packages/ai/src/ai-models-available.ts`
- Create: `packages/ai/src/ai-models-available.test.ts`
- Modify: `packages/ai/package.json` — export `./ai-models-available`

- [ ] **Step 1:** Define types:

```typescript
export type AiProviderId =
  | "openrouter"
  | "openai"
  | "anthropic"
  | "ollama"
  | "openai-compatible";

export interface AiModelOption {
  id: string;
  label: string;
}

export const PROVIDER_LABELS: Record<AiProviderId, string> = { ... };

export const OPENROUTER_MODELS: AiModelOption[] = [
  { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4 (OpenRouter)" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o mini (OpenRouter)" },
];

export const OPENAI_MODELS: AiModelOption[] = [
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4o-mini", label: "GPT-4o mini" },
];

export const ANTHROPIC_MODELS: AiModelOption[] = [
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
];

export const OLLAMA_MODELS: AiModelOption[] = [
  { id: "llama3.2", label: "Llama 3.2" },
];

export const OPENAI_COMPAT_MODELS: AiModelOption[] = [
  { id: "local-model", label: "Local model" },
];

/** All models grouped by provider — not filtered by env. */
export const AI_MODELS_BY_PROVIDER: Record<AiProviderId, AiModelOption[]> = { ... };
```

- [ ] **Step 2:** Helpers:

```typescript
export type ProviderModelValue = `${AiProviderId}:${string}`;

export function parseProviderModelValue(
  value: string,
): { provider: AiProviderId; modelId: string } | null;

export function toProviderModelValue(
  provider: AiProviderId,
  modelId: string,
): ProviderModelValue;

export function isKnownCatalogModel(
  provider: AiProviderId,
  modelId: string,
): boolean;

export function getAiProviderModelOptions(): {
  value: ProviderModelValue;
  label: string;
  groupLabel: string;
}[];
```

- [ ] **Step 3:** Presets (code defaults, not env):

```typescript
export const AI_MODEL_PRESETS = {
  assistant: "openrouter:anthropic/claude-sonnet-4",
  worker: "openai:gpt-4o-mini",
  local: "ollama:llama3.2",
} as const satisfies Record<string, ProviderModelValue>;

export type AiModelPreset = keyof typeof AI_MODEL_PRESETS;

export const DEFAULT_PROVIDER_MODEL: ProviderModelValue =
  AI_MODEL_PRESETS.assistant;
```

- [ ] **Step 4:** Tests for parse/to and `isKnownCatalogModel`.
- [ ] **Step 5:** Commit `feat(ai): central ai-models-available catalog`

---

### Task 2: Filter by configured API keys

**Files:**
- Create: `packages/ai/src/list-available-ai-models.ts`
- Create: `packages/ai/src/list-available-ai-models.test.ts`
- Create: `packages/ai/src/provider-configured.ts` (optional helper)

- [ ] **Step 1:** `isProviderConfigured(config, provider)`:

| Provider | Configured when |
|----------|-----------------|
| `openrouter` | `OPENROUTER_API_KEY` non-empty |
| `openai` | `OPENAI_API_KEY` non-empty |
| `anthropic` | `ANTHROPIC_API_KEY` non-empty |
| `ollama` | always true if `OLLAMA_BASE_URL` unset (use default) OR URL set |
| `openai-compatible` | `AI_OPENAI_COMPAT_BASE_URL` non-empty |

- [ ] **Step 2:**

```typescript
import type { keys } from "../keys";

export function getAvailableAiModels(
  config: ReturnType<typeof keys>,
): ReturnType<typeof getAiProviderModelOptions> {
  // filter getAiProviderModelOptions() to providers where isProviderConfigured
}

export function getDefaultAvailableProviderModel(
  config: ReturnType<typeof keys>,
): ProviderModelValue | null {
  // first preset in order [assistant, worker, local] that is available
  // else first option in getAvailableAiModels
}
```

- [ ] **Step 3:** Tests with `vi.stubEnv` for single-provider scenarios.
- [ ] **Step 4:** Export from `packages/ai/package.json` as `./list-available-ai-models` (document: server-only).
- [ ] **Step 5:** Commit `feat(ai): filter available models by env keys`

---

### Task 3: `resolveProviderModel` + refactor `getModel()`

**Files:**
- Create: `packages/ai/src/resolve-provider-model.ts`
- Modify: `packages/ai/src/get-model.ts`
- Rewrite: `packages/ai/src/get-model.test.ts`
- Modify: `packages/ai/src/index.ts`
- Modify: `packages/ai/src/run-agent.ts` — accept `providerModel` / `preset` on input

- [ ] **Step 1:** `resolveProviderModel(config, value: string)`:

  1. `parseProviderModelValue(value)` or null
  2. `isKnownCatalogModel(provider, modelId)` or throw
  3. `isProviderConfigured(config, provider)` or throw readable error
  4. return `{ provider, modelId }`

- [ ] **Step 2:** Change signature:

```typescript
export type GetModelOptions =
  | { providerModel: ProviderModelValue }
  | { preset: AiModelPreset };

export function getModel(
  options: GetModelOptions,
): LanguageModel {
  const config = keys();
  const value =
    "preset" in options
      ? AI_MODEL_PRESETS[options.preset]
      : options.providerModel;
  const { provider, modelId } = resolveProviderModel(config, value);
  // existing provider switch using modelId
}
```

- [ ] **Step 3:** Remove `getDefaultModelForProvider` tied to env; delete `AI_PROVIDER` / `AI_MODEL` usage.

- [ ] **Step 4:** Update `runAgent` input:

```typescript
export type RunAgentInput = {
  // ...
} & GetModelOptions;
```

Pass through to `getModel(options)`.

- [ ] **Step 5:** Rewrite tests; run `pnpm --filter @workspace/ai test`.
- [ ] **Step 6:** Commit `refactor(ai): getModel from catalog and presets`

---

### Task 4: Clean up `keys.ts` and `.env.example`

**Files:**
- Modify: `packages/ai/keys.ts`, `packages/ai/src/keys.test.ts`
- Modify: `.env.example`, `packages/ai/README.md`

- [ ] **Step 1:** Remove `AI_PROVIDER` and `AI_MODEL` from Zod schema and `keys()`.

- [ ] **Step 2:** Keep: `AI_AGENT_MAX_STEPS`, `AI_MAX_OUTPUT_TOKENS`, `AI_TEMPERATURE`, all `*_API_KEY` / base URLs, Langfuse.

- [ ] **Step 3:** Update `.env.example`:

```bash
# Model routing: packages/ai/src/ai-models-available.ts (not env).
# Set API keys for providers you want; only configured providers appear in the UI.
AI_AGENT_MAX_STEPS=5
# OPENROUTER_API_KEY=
# OPENAI_API_KEY=
# ANTHROPIC_API_KEY=
# OLLAMA_BASE_URL=http://localhost:11434/v1
```

- [ ] **Step 4:** README: link to catalog file, presets table, selector behavior.
- [ ] **Step 5:** Commit `chore(ai): remove AI_PROVIDER and AI_MODEL from env`

---

### Task 5: Server action — list available models

**Files:**
- Modify: `apps/dashboard/features/ai-chat/data/ai-chat-actions.ts`

- [ ] **Step 1:** Add:

```typescript
export async function listAvailableAiModelsAction() {
  await requireUser();
  const { keys } = await import("@workspace/ai/keys");
  const { getAvailableAiModels, getDefaultAvailableProviderModel } =
    await import("@workspace/ai/list-available-ai-models");

  const config = keys();
  const models = getAvailableAiModels(config);
  const defaultValue = getDefaultAvailableProviderModel(config);

  if (models.length === 0) {
    return {
      success: false as const,
      error: "No AI providers configured. Add API keys to .env and restart.",
    };
  }

  return {
    success: true as const,
    data: { models, defaultValue },
  };
}
```

- [ ] **Step 2:** Colocated test with mocked `keys` if practical.
- [ ] **Step 3:** Commit `feat(dashboard): list available ai models action`

---

### Task 6: `AiProviderModelSelect` component

**Files:**
- Create: `apps/dashboard/features/ai-chat/ui/ai-provider-model-select.tsx`

- [ ] **Step 1:** Client component modeled on Bloomlogic `ai-provider-model-select.tsx`:

  - Props: `value: ProviderModelValue`, `onValueChange`, `options` (from server), `disabled?`, `triggerClassName?`
  - Grouped `Select` from `@workspace/ui/components/select`
  - Display: `{groupLabel} · {label}`

- [ ] **Step 2:** Do **not** import `keys()` or `list-available-ai-models` in client file — options passed as props only.

- [ ] **Step 3:** Commit `feat(dashboard): ai provider model select component`

---

### Task 7: Wire selector + transport into chat UI

**Files:**
- Modify: `apps/dashboard/features/ai-chat/ui/ai-chat-page-content.tsx`

- [ ] **Step 1:** On mount, call `listAvailableAiModelsAction()`; set `providerModel` state to `defaultValue`; show empty-state if `success: false`.

- [ ] **Step 2:** Render `AiProviderModelSelect` in header area (e.g. below `PageHeaderInOrg` or in input toolbar).

- [ ] **Step 3:** Pass selection into chat transport. Use AI SDK v6 pattern, e.g.:

```typescript
const transport = useMemo(
  () =>
    new DefaultChatTransport({
      api: "/api/ai/chat",
      body: { providerModel },
    }),
  [providerModel],
);

const { messages, sendMessage, status, setMessages, error } = useChat({
  transport,
});
```

If `body` must be a function per request, use `() => ({ providerModel })`.

- [ ] **Step 4:** Disable send when no models available; update error fallback text (no `AI_PROVIDER` mention).

- [ ] **Step 5:** Manual test: only OpenRouter key → only OpenRouter group in dropdown.
- [ ] **Step 6:** Commit `feat(dashboard): model selector in ai assistant chat`

---

### Task 8: Chat API route validation

**Files:**
- Modify: `apps/dashboard/app/api/ai/chat/route.ts`

- [ ] **Step 1:** Parse body:

```typescript
const { messages, providerModel } = (await req.json()) as {
  messages: UIMessage[];
  providerModel?: string;
};
```

- [ ] **Step 2:** Resolve model:

```typescript
import { getModel } from "@workspace/ai";
import { keys } from "@workspace/ai/keys";
import {
  getDefaultAvailableProviderModel,
} from "@workspace/ai/list-available-ai-models";
import { resolveProviderModel } from "@workspace/ai/resolve-provider-model";
import { DEFAULT_PROVIDER_MODEL } from "@workspace/ai/ai-models-available";

const config = keys();
const value =
  providerModel ??
  getDefaultAvailableProviderModel(config) ??
  DEFAULT_PROVIDER_MODEL;

let model;
try {
  resolveProviderModel(config, value); // validate first
  model = getModel({ providerModel: value as ProviderModelValue });
} catch (err) {
  return Response.json(
    { error: err instanceof Error ? err.message : "Invalid model" },
    { status: 400 },
  );
}
```

- [ ] **Step 3:** Remove 503 branch that references `AI_PROVIDER`.
- [ ] **Step 4:** Optional: store `providerModel` in `appendAssistantMessage` metadata for analytics.
- [ ] **Step 5:** Commit `feat(dashboard): validate providerModel on chat route`

---

### Task 9: Workers + promptfoo alignment

**Files:**
- Modify: `apps/workers/src/handlers/ai-example.ts` (if exists)
- Modify: `evals/promptfoo/promptfooconfig.yaml` (if exists) — document preset model ids

- [ ] **Step 1:** Worker uses `getModel({ preset: "worker" })` with try/catch clear message.

- [ ] **Step 2:** If worker preset unavailable (no OpenAI key), log skip warning in handler test.

- [ ] **Step 3:** Commit `chore(workers): use ai model preset for example handler`

---

### Task 10: Verification

- [ ] `pnpm type-check`
- [ ] `pnpm lint`
- [ ] `pnpm test --filter @workspace/ai --filter dashboard`
- [ ] Manual: `.env` with only `OPENROUTER_API_KEY` → dropdown shows OpenRouter models only; chat works
- [ ] Manual: invalid `providerModel` in API → 400
- [ ] Manual: no keys → selector empty state, helpful message

- [ ] Commit any fixups: `chore: ai models catalog verification`

---

## Optional follow-up (out of scope)

- `AiThread.preferredProviderModel` column — persist last selection per thread
- Filter presets when preset provider unavailable (fallback chain)
- `GET /api/ai/models` public route vs server action only

---

## Verification

- `pnpm type-check`
- `pnpm lint`
- `pnpm test --filter @workspace/ai`
- `pnpm test --filter dashboard`
