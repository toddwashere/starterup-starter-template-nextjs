---
name: add-new-app
description: Add a new app to the monorepo workspace. Use when creating a new directory under apps/, a new package.json in apps/, or setting up any runnable service — Next.js app, API server, webhook listener, background worker, preview server, email preview, or any new entry in apps/.
---

# Add New App

## Purpose

Use this skill whenever adding a new application to the `apps/` directory. The monorepo uses Turborepo with the TUI enabled, pnpm workspaces, and shared packages — new apps must follow these conventions to integrate correctly.

## Core Rule

Every app in `apps/` with a `dev` script automatically appears in the Turborepo TUI when running `pnpm dev`. Port allocation starts at 4000 and increments per app. Apps use the `@apps/<app-name>` package scope; packages use `@workspace/<package-name>`.

## Before Starting

1. Decide what type of app this is: Next.js web app, API server, webhook listener, background worker, CLI tool, etc.
2. Check existing apps in `apps/` to understand naming and port allocation.
3. Check `pnpm-workspace.yaml` — it already includes `apps/*`, so new apps are auto-discovered.
4. Check `turbo.json` — the `dev` task is configured globally with `persistent: true` and `cache: false`.

## Port Allocation

Apps use ports starting at 4000, assigned sequentially:

| App         | Port |
| ----------- | ---- |
| dashboard   | 4000 |
| www         | 4001 |
| *(next app)*| 4002 |
| *(next app)*| 4003 |

When adding a new app, use the next available port. Keep this table updated in this skill file.

## Implementation Checklist

### 1. Create the App Directory

```
apps/<app-name>/
├── package.json
├── tsconfig.json
└── src/ or app/ (depending on framework)
```

Use kebab-case for the directory name.

### 2. Configure package.json

Required fields:

```json
{
  "name": "@apps/<app-name>",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "<dev command> --port <next-available-port>",
    "build": "<build command>",
    "lint": "eslint .",
    "type-check": "tsc --noEmit",
    "clean": "rm -rf .next .turbo node_modules dist"
  }
}
```

Key requirements:

- **Name**: Must use `@apps/<app-name>` scope (apps use `@apps/`, packages use `@workspace/`).
- **dev script**: Must exist for the app to appear in the TUI. Must specify the allocated port.
- **build script**: Required for `turbo run build` to work.
- **clean script**: Include relevant build output directories.

### 3. For Next.js Apps

Follow the same structure as `apps/dashboard` or `apps/www`:

```json
{
  "scripts": {
    "dev": "next dev --port <PORT>",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "type-check": "tsc --noEmit",
    "clean": "rm -rf .next .turbo node_modules"
  },
  "dependencies": {
    "@workspace/common": "workspace:*",
    "@workspace/routes": "workspace:*",
    "next": "^16.2",
    "react": "^19.1",
    "react-dom": "^19.1"
  },
  "devDependencies": {
    "@types/node": "^24",
    "@types/react": "^19.1",
    "@types/react-dom": "^19.1",
    "@workspace/tooling": "workspace:*",
    "eslint": "^9.18",
    "typescript": "^5.7"
  }
}
```

### 4. For Non-Next.js Apps (API servers, workers, listeners)

Use a long-running `dev` script so the app stays alive in the TUI:

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts --port <PORT>"
  }
}
```

If the app doesn't naturally stay alive (e.g., a stub or placeholder), use a keepalive pattern:

```json
{
  "scripts": {
    "dev": "node -e \"console.log('<app-name> running'); setInterval(()=>{}, 1e9);\""
  }
}
```

### 5. Add Shared Package Dependencies

Add workspace packages as needed:

```json
{
  "dependencies": {
    "@workspace/common": "workspace:*",
    "@workspace/routes": "workspace:*"
  },
  "devDependencies": {
    "@workspace/tooling": "workspace:*"
  }
}
```

### 6. Install Dependencies

Run from the monorepo root:

```bash
pnpm install
```

This updates the lockfile and links workspace dependencies.

### 7. Verify

Run `pnpm dev` from the root. The new app should appear as `<app-name>#dev` in the Turborepo TUI sidebar.

## Turborepo Integration

No changes to `turbo.json` or the root `package.json` are needed. The setup auto-discovers apps:

- `pnpm-workspace.yaml` includes `apps/*` — new directories are auto-included.
- `turbo.json` `dev` task applies globally — any package with a `dev` script gets it.
- `"ui": "tui"` in `turbo.json` enables the interactive terminal UI.

## Naming

- Directory: `kebab-case` (e.g., `apps/admin-portal`, `apps/webhook-listener`)
- Package name: `@apps/<directory-name>` (apps use `@apps/` scope)
- Keep names concise — they appear in the TUI sidebar with limited width.

## What NOT To Do

- Do not add the app manually to `turbo.json` task definitions — it's automatic.
- Do not use ports below 4000 or duplicate an existing port.
- Do not skip the `dev` script — without it, the app won't appear in the TUI.
- Do not add the app to a `filter` in the root dev script — all apps run by default.
