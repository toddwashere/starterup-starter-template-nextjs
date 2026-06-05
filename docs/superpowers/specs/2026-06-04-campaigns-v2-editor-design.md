# Campaigns v2 — WYSIWYG Email Authoring

**Date:** 2026-06-04  
**Status:** Ready for review  
**Supersedes (partial):** [`2026-06-04-campaigns-design.md`](./2026-06-04-campaigns-design.md) template authoring section only  
**Scope:** `packages/email`, `packages/campaigns`, `apps/dashboard/features/campaigns`

## Overview

Improve campaign/follow-up authoring UX with an embeddable **React Email Editor** ([docs](https://react.email/docs/editor/overview)) while keeping compliance and send infrastructure unchanged.

v1 shipped registry templates with hardcoded dashboard fields. v2 adds:

1. **Developer-owned compliance shell** — `MarketingEmailComplianceFooter` injected at send time (implemented)
2. **WYSIWYG step content** — `@react-email/editor` in the dashboard
3. **Hybrid content sources** — `registry` (code templates) or `editor` (stored JSON + composed HTML)
4. **UX polish** — human delay presets, dynamic registry fields, live preview

## Decisions

| Topic | Decision |
|-------|----------|
| Compliance footer | Developer React Email component; never user-editable; injected via `assembleMarketingEmail` |
| Editor | `@react-email/editor` (MIT) embedded in dashboard step editor |
| Storage | `EmailSequenceStep.contentSource` + `editorDocument Json?` + `composedBodyHtml?` + `composedBodyText?` |
| Compose timing | Client composes on save/preview; server stores HTML + JSON; send uses stored HTML + footer injection |
| Registry templates | Remain for starter layouts; body-only components wrapped by document shell |
| Images in editor | Deferred — no upload API in v2.0 |
| Merge fields | Post-process `{{field}}` in subject + composed HTML/text at send time |

## Architecture

```text
Dashboard step editor
  ├─ contentSource: registry → dynamic fields from propsSchema
  └─ contentSource: editor   → @react-email/editor embed
        save → editorDocument JSON + composeReactEmail → composedBodyHtml/Text

Send (unchanged envelope)
  registry → renderBody → assembleMarketingEmail → rewrite links → send
  editor   → composedBodyHtml → assembleMarketingEmailFromEditorHtml → rewrite links → send
```

## Data model changes

`EmailSequenceStep`:

- `contentSource String @default("registry")` — `registry` | `editor`
- `editorDocument Json?` — TipTap document JSON
- `composedBodyHtml String?` — cached export (user content region)
- `composedBodyText String?` — plain-text export

Existing rows default to `registry`; no migration of content required.

## Critical Tests

- `packages/email/src/marketing/assemble-marketing-email.test.tsx`: compliance footer in assembled output
- `packages/campaigns/src/services/step-send-service.test.ts`: editor contentSource send path uses composed HTML
- `packages/campaigns/src/schemas/sequence-schemas.test.ts`: editor steps require composedBodyHtml when contentSource is editor
- `apps/dashboard/features/campaigns/common/ui/sequence-steps-editor.test.ts`: delay preset converts to minutes

## Non-Goals (v2)

- Org-wide reusable template library table
- Image upload to object storage
- Topic preferences
- Full removal of registry templates

## Verification

- `pnpm test --filter @workspace/email --filter @workspace/campaigns`
- Manual: create follow-up with editor content, send test, confirm footer + unsubscribe in received email
