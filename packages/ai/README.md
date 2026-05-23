# @workspace/ai

Provider-agnostic LLM infrastructure built on the Vercel AI SDK v6.

This package provides a factory for instantiating configured language models, a capped agent runner for multi-turn reasoning with tool use, versioned system prompts, and optional observability via Langfuse. It has no imports of Prisma, MCP, or app code—just core AI infrastructure.

## Public API

- **`getModel()`** — Instantiate a language model based on `AI_PROVIDER` env var and matching provider credentials
- **`getGenerationDefaults()`** — Fetch default generation params (`maxTokens`, `temperature`, etc.) from env
- **`runAgent(input)`** — Execute a multi-turn agent with tool support, yielding final text and tool-call history
- **`buildTelemetryOptions(ctx)`** — Build Vercel AI SDK `experimental_telemetry` option (only active when Langfuse keys are set)
- **`ASSISTANT_SYSTEM_PROMPT`** — Versioned system prompt (imported from `@workspace/ai/prompts/assistant-system`)

See `src/index.ts` and individual files for type signatures.

## Environment Setup

Configuration is read from `@workspace/ai/keys`. See `.env.example` in the repo root for all options.

Required at call time:
- **`AI_PROVIDER`** — One of: `openrouter | openai | anthropic | ollama | openai-compatible`
- **Matching provider key** — `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.

Optional:
- **`AI_MODEL`** — Model identifier (e.g., `anthropic/claude-sonnet-4`)
- **`AI_MAX_OUTPUT_TOKENS`**, **`AI_TEMPERATURE`**, **`AI_AGENT_MAX_STEPS`**

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
