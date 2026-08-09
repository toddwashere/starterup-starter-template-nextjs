# Turnkey AWS Deploy Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship turnkey AWS deploy primitives (flat DNS, CI split, migrate Lambda, dual alerts, public-URL CLI) into this template without product-specific apps.

**Architecture:** Copy product-free helpers from the working downstream shape; wire template apps only; keep shared APIs identical for one-way upstream sync.

**Tech Stack:** Pulumi AWS, App Runner, Lambda, Route 53, SNS, Chatbot, GitHub Actions OIDC.

**Design spec:** [`docs/superpowers/specs/2026-08-08-turnkey-aws-deploy-design.md`](../specs/2026-08-08-turnkey-aws-deploy-design.md)

---

## File Structure

See the design spec and the Cursor plan. Key creates: `apprunner-route53.ts`,
`alarms.ts` (core/apps), `chatbot.ts`, `Dockerfile.migrate`, `migrate-handler.*`,
`public-url-outputs.ts`, `infra-aws.yml`, `release-aws-apps.yml`.

## Critical Tests

- `infra/aws/apps/apprunner-route53.test.ts`: unknown region throws; known zones.
- `infra/shared/public-urls.test.ts`: flat host resolution; delegated hosts.
- `infra/aws/scripts/aws.test.ts`: `withRefresh` injects `--refresh` on `up`.
- `infra/aws/apps/apprunner-source-image.test.ts`: merge preserves env/secrets/port.
- `infra/aws/apps/deploy-app-release-iam.test.ts`: narrow release policy scope.
- `packages/database/src/migrate-handler.test.ts`: structured failures; parse applied.
- `infra/aws/core/alarms.mock.test.ts` / `infra/aws/apps/alarms.mock.test.ts`:
  severity tiers; silent children + composite.
- `infra/aws/bootstrap/chatbot.test.ts`: Chatbot no-ops without Slack IDs.
- `infra/shared/public-url-outputs.test.ts`: GitHub output formatting; template keys.

## Task 1: Flat DNS + public URLs

- [x] `resolveAppHost`, per-host zones, alias custom domains, dashboard label

## Task 2: Image ownership + CI split + release IAM

- [x] `withRefresh`, `ignoreChanges`, `appReleaseRole`, source-image helper, workflows

## Task 3: Migrate Lambda

- [x] Handler, Dockerfile, ECR image, apps Lambda, release invoke path

## Task 4: Dual SNS + Tier-1 alarms + Chatbot

- [x] Warning topic, core/apps alarms, optional Slack

## Task 5: Public URL CLI + docs

- [x] `infra:public-urls`, `test:infra`, GETTING_STARTED/README, design/plan docs
