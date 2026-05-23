# @workspace/ai

Provider-agnostic LLM infrastructure built on the Vercel AI SDK v6.

This package provides a factory for instantiating configured language models, a capped agent runner for multi-turn reasoning with tool use, versioned system prompts, and optional observability via Langfuse. It has no imports of Prisma, MCP, or app code—just core AI infrastructure.

## Public API

- **`getModel({ providerModel } | { preset })`** — Instantiate a language model from a `provider:modelId` string or a named preset. Throws a readable error when the provider's credentials are missing
- **`resolveAiCallOptions(options)`** — Merge a preset with overrides into a `ResolvedAiCall` (model + generation params). Pure; does no key validation
- **`getGenerationParams(resolved)`** — Generation params (`temperature`, `maxOutputTokens`) to spread into `generateText` / `streamText`
- **`logAiCall(event)`** — Record the canonical `providerModel` used for a call (structured `console.info`)
- **`runAgent(input)`** — Execute a multi-turn agent with tool support, yielding final text and tool-call history. Defaults to the `assistant` preset
- **`buildTelemetryOptions(ctx)`** — Build Vercel AI SDK `experimental_telemetry` option (only active when Langfuse keys are set); carries `providerModel` in metadata
- **`ASSISTANT_SYSTEM_PROMPT`** — Versioned system prompt (`@workspace/ai/prompts/assistant-system`)

Subpath modules:

- **`@workspace/ai/ai-models-available`** — Client-safe catalog: per-provider model lists, `parseProviderModelValue` / `toProviderModelValue`, `isKnownCatalogModel`, `getAiProviderModelOptions`, `AI_CALL_PRESETS`, `DEFAULT_PROVIDER_MODEL`
- **`@workspace/ai/list-available-ai-models`** *(server)* — `getAvailableAiModels(keys())` and `getDefaultAvailableProviderModel(keys())`, filtered to providers with configured credentials
- **`@workspace/ai/resolve-provider-model`** *(server)* — `resolveProviderModel(keys(), value)`: validates a value against the catalog **and** configured keys before `getModel()`

See `src/index.ts` and individual files for type signatures.

## Model catalog & presets

Models are not selected via env. The full allowlist lives in
`src/ai-models-available.ts`, encoded as `provider:modelId`
(e.g. `openrouter:anthropic/claude-sonnet-4`). Named presets bundle a default
model with generation params:

| Preset | Model (`providerModel`) | maxSteps | temperature | maxOutputTokens |
|--------|-------------------------|---------:|------------:|----------------:|
| `assistant` | `openrouter:anthropic/claude-sonnet-4` | 5 | 0.7 | 4096 |
| `worker` | `openai:gpt-4o-mini` | 1 | 0 | 1024 |
| `local` | `ollama:llama3.2` | 5 | 0.7 | — |

Call sites pass `resolveAiCallOptions({ preset, overrides? })`. Chat overrides the
model with the user's selection; workers use `{ preset: "worker" }`. Only
providers whose credentials are configured appear in the dashboard selector,
and the server revalidates the chosen value with `resolveProviderModel` before
constructing a model.

## Environment Setup

Configuration is read from `@workspace/ai/keys` — **secrets only**. See
`.env.example` in the repo root for all options. There are no `AI_PROVIDER`,
`AI_MODEL`, `AI_AGENT_MAX_STEPS`, `AI_TEMPERATURE`, or `AI_MAX_OUTPUT_TOKENS`
variables; set an API key (or base URL) for each provider you want available:

- **`OPENROUTER_API_KEY`** (+ optional `OPENROUTER_HTTP_REFERER`, `OPENROUTER_APP_NAME`)
- **`OPENAI_API_KEY`** (+ optional `OPENAI_BASE_URL`)
- **`ANTHROPIC_API_KEY`**
- **`OLLAMA_BASE_URL`** — Ollama is offered by default at `http://localhost:11434/v1`
- **`AI_OPENAI_COMPAT_BASE_URL`** (+ optional `AI_OPENAI_COMPAT_API_KEY`)

## Agent Tool Execution

`runAgent(input)` accepts:
- **`tools`** — Array of `AgentTool` definitions (name, description, parameters)
- **`executeTool(name, args)`** — Optional async callback to handle tool execution

The package does **not** assume or invoke MCP; it's tool-agnostic. Integration points:
- **Dashboard** — Injects MCP execution at the route handler level
- **Workers** — Inject in-process function handlers
- The package itself is unaware of either pattern

## Optional: Langfuse Observability

`buildTelemetryOptions(ctx)` emits structured telemetry only when **both**:
- `LANGFUSE_PUBLIC_KEY` is set
- `LANGFUSE_SECRET_KEY` is set

If either is missing, tracing is disabled and the app runs without observability. The host app (e.g., Next.js) must register the Langfuse OTEL span processor once (e.g., in `instrumentation.ts`) to export traces to cloud or self-hosted Langfuse. Wiring full trace IDs back onto message records is a documented v1 follow-up.

## See Also

- **Thread/message persistence** — `@workspace/ai-chat` (separate package with Prisma integration)
- **AI-chat routes & MCP bridge** — Dashboard app (tools/orchestration layer)
- **Worker example** — Apps/workers (background job using `generateText`)
