# AI prompt evals (promptfoo)

> **Costs money.** `pnpm eval:ai` sends live requests to your configured LLM provider and **uses API tokens** unless promptfoo serves a cached response. This is not part of `pnpm test`.

## Commands

| Script | Tokens? | Purpose |
|--------|---------|---------|
| `pnpm eval:ai` | Yes (on cache miss) | Run golden tests; identical prompt/provider/vars reuse the disk cache (14-day TTL) |
| `pnpm eval:ai:live` | Yes (always) | Same as `eval:ai` but `--no-cache` — forces fresh LLM calls |
| `pnpm eval:ai:view` | **No** | Open the local browser UI for past eval results |

Requires a provider API key in root `.env` (e.g. `OPENROUTER_API_KEY`). See [`assistant-chat/promptfooconfig.yaml`](./assistant-chat/promptfooconfig.yaml).

## Free alternative

For prompt rendering, variable schemas, and call wiring, use Vitest (no API key):

```bash
pnpm test --filter @workspace/ai
```

## Viewing last results

Eval history is stored locally under `~/.promptfoo/` (not in this repo):

```bash
pnpm eval:ai:view
# or
npx promptfoo@latest list evals -n 5
npx promptfoo@latest show eval
```

## Config layout

One config folder per named AI call (`evals/promptfoo/<call>/`):

- [`assistant-chat/promptfooconfig.yaml`](./assistant-chat/promptfooconfig.yaml) — provider + default vars; points at the source prompt `packages/ai/src/ai-calls/assistant-chat/prompt.md` (no duplicate copy)
- [`assistant-chat/tests/golden.yaml`](./assistant-chat/tests/golden.yaml) — behavioral assertions (length, keywords)

## Cache behavior

promptfoo caches LLM responses by default (`~/.promptfoo/cache`). Re-running unchanged evals should not call the API again. Clear with:

```bash
npx promptfoo@latest cache clear
```

Use `pnpm eval:ai:live` only when you intentionally want fresh model outputs.
