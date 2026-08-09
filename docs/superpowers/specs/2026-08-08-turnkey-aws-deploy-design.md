# Turnkey AWS Deploy

**Date:** 2026-08-08  
**Status:** Approved

## Overview

Make the starter template’s AWS App Runner profile close to turnkey: NS-only DNS
at the registrar for every environment, split infra vs app-release CI, in-VPC
migrations (no database URL in GitHub), dual-tier CloudWatch alerts, and a
shared public-URL CLI for image build-args.

Shared helper modules match the working downstream shape so one-way upstream
syncs stay merge-friendly. Product-only apps and surfaces are out of scope.

## Architecture

- **DNS:** Flat hosts via `resolveAppHost`; one Route 53 zone per public hostname;
  Alias A + ACM via `apprunner-route53.ts` / `custom-domains.ts`.
- **CI:** `infra-aws.yml` (dispatch, fat role) + `release-aws-apps.yml` (narrow
  app-release role). Image fields use `ignoreChanges`; local `pulumi up`
  forces `--refresh`.
- **Migrate:** Dedicated Lambda + `Dockerfile.migrate` + `migrate-handler.mjs`.
- **Alerts:** Critical + warning SNS topics; optional Slack Chatbot; Tier-1
  queue/RDS/App Runner/Lambda alarms.
- **URLs:** `pnpm infra:public-urls` is the only CI source of public hostnames.

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

## Verification

- `pnpm test:infra` (after `pnpm --dir infra/aws install`)
- Targeted layer vitest suites under `infra/aws/{bootstrap,core,apps}`
- `pnpm --filter @workspace/database exec vitest run src/migrate-handler.test.ts`
