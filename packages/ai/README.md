# @workspace/ai

Provider-agnostic LLM infrastructure built on the Vercel AI SDK v6.

Every LLM use case is a **named AI call** under `src/ai-calls/<name>/`: an editable
`prompt.md` (with `{{variable}}` placeholders) plus one TypeScript module for the
variable schema, call config, and public command. Shared plumbing — the model
catalog, prompt rendering, and SDK execution — lives in `src/platform/`. Apps build
variables and call a command (e.g. `askAssistantChat`); they never call
`streamText` / `generateText` directly.

## Layout

```
src/
  platform/                       shared infra (no per-call logic)
    models/ai-models-available.ts catalog + AI_CALL_PRESETS (client-safe)
    define-ai-call.ts             call factory + prompt loader
    render-prompt.ts              Mustache render + placeholder validation
    extract-template-vars.ts      parse {{vars}} from a template
    ask-ai.ts                     validate → render → log → stream/generate
    get-model.ts, resolve-*.ts, get-generation-params.ts, log-ai-call.ts,
    telemetry.ts, run-agent.ts, provider-configured.ts, list-available-ai-models.ts
  data-models/                    domain-owned Prisma repos (shared across AI calls)
    ai-thread-repo.ts             AiThread CRUD + org/user scoping
    ai-message-repo.ts            AiMessage CRUD + thread ownership checks
  ai-calls/
    assistant-chat/               prompt.md, assistant-chat.ts, schemas.ts
    worker-example/               prompt.md, worker-example.ts
    index.ts                      AI_CALLS registry
```

## Defining / editing a call

Each `ai-calls/<name>/<name>.ts` exports a Zod `variables` schema, a `call`
(`defineAiCall`), and a public command:

```typescript
export const variables = z.object({ orgName: z.string().min(1) });

export const call = defineAiCall({
  id: "assistant-chat",          // also the log functionId
  importMetaUrl: import.meta.url, // resolves prompt.md next to this file
  prompt: "./prompt.md",
  preset: "assistant",
  mode: "stream",                // "stream" | "generate" | "agent"
  variables,
});

export async function askAssistantChat(input) {
  return askAi(call, input);
}
```

- **Non-engineers** edit `prompt.md`. Placeholders use Mustache: `{{var}}` and
  optional `{{#section}}…{{/section}}` blocks. A contract test asserts the
  placeholders match the Zod schema keys.
- **Engineers** wire the variable sources in apps and call the command.
- `askAi` validates variables, resolves the preset (+ overrides), renders the
  prompt, logs the call, and dispatches to the SDK by `mode`.

## Model catalog & presets

Models are not selected via env. The full allowlist lives in
`src/platform/models/ai-models-available.ts`, encoded as `provider:modelId`
(e.g. `openrouter:anthropic/claude-sonnet-4`). Named presets bundle a default
model with generation params:

| Preset | Model (`providerModel`) | maxSteps | temperature | maxOutputTokens |
|--------|-------------------------|---------:|------------:|----------------:|
| `assistant` | `openrouter:anthropic/claude-sonnet-4` | 5 | 0.7 | 4096 |
| `worker` | `openai:gpt-4o-mini` | 1 | 0 | 1024 |
| `local` | `ollama:llama3.2` | 5 | 0.7 | — |

A per-request `overrides.providerModel` (e.g. the dashboard selector) is
revalidated server-side with `resolveProviderModel` (catalog + configured keys)
before the model is constructed.

### Subpath modules

- **`@workspace/ai/ai-models-available`** — Client-safe catalog + presets + parse helpers
- **`@workspace/ai/list-available-ai-models`** *(server)* — filter the catalog by configured keys
- **`@workspace/ai/resolve-provider-model`** *(server)* — validate a value before `getModel()`
- **`@workspace/ai/ai-calls/assistant-chat`** — `askAssistantChat`, `call`, `variables`
- **`@workspace/ai/data-models/ai-thread-repo`** *(server, Prisma)* — `AiThread` repository
- **`@workspace/ai/data-models/ai-message-repo`** *(server, Prisma)* — `AiMessage` repository
- **`@workspace/ai/ai-calls/assistant-chat/schemas`** — feedback Zod schemas
- **`@workspace/ai/ai-calls/worker-example`** — `runWorkerExample`, `call`

## Environment Setup

Configuration is read from `@workspace/ai/keys` — **secrets only**. See
`.env.example` in the repo root. There are no `AI_PROVIDER`, `AI_MODEL`,
`AI_AGENT_MAX_STEPS`, `AI_TEMPERATURE`, or `AI_MAX_OUTPUT_TOKENS` variables; set an
API key (or base URL) for each provider you want available:

- **`OPENROUTER_API_KEY`** (+ optional `OPENROUTER_HTTP_REFERER`, `OPENROUTER_APP_NAME`)
- **`OPENAI_API_KEY`** (+ optional `OPENAI_BASE_URL`)
- **`ANTHROPIC_API_KEY`**
- **`OLLAMA_BASE_URL`** — Ollama is offered by default at `http://localhost:11434/v1`
- **`AI_OPENAI_COMPAT_BASE_URL`** (+ optional `AI_OPENAI_COMPAT_API_KEY`)

## Optional: Langfuse Observability

`buildTelemetryOptions(ctx)` emits structured telemetry only when **both**
`LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are set; otherwise tracing is
disabled and the app runs normally. The host app registers the Langfuse OTEL span
processor once (e.g. in `instrumentation.ts`). The canonical `providerModel` is
included in telemetry metadata.

## Testing

- **Vitest** (CI, no API keys): per-call render + contract tests, platform unit
  tests, and colocated data-model repo tests. Run `pnpm test --filter @workspace/ai`.
- **promptfoo** (optional API key): prompt-quality evals per call under
  `evals/promptfoo/<call>/`, pointing at the source `prompt.md`. Run `pnpm eval:ai`.

## See Also

- **AI Assistant route & MCP bridge** — `apps/dashboard` (auth, tools, variable assembly)
- **Worker example** — `apps/workers` (`runWorkerExample`)
