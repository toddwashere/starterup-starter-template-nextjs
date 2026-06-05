# Secret Files

AI agents must not read, quote, summarize, search, or otherwise inspect local secret files.

Use `.env.example` as the only source of truth when environment variables are needed for code changes, debugging, documentation, or setup instructions.

Do not open files that may contain local credentials, including:

- `.env`
- `.env.*`, except `.env.example`
- `*.pem`
- `*.key`
- `*.p12`
- `*.pfx`
- `*credentials*.json`
- `*secret*.json`
- files under `secrets/`

If a task appears to require a real secret value, ask the user to confirm the relevant variable name or shape without revealing the value. Never request the value itself unless the user explicitly chooses to provide it.
