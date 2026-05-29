#!/usr/bin/env bash
#
# smoke-mobile-auth.sh — LOCAL DEV ONLY
#
# Exercises the OAuth-Bearer mobile routes of the public API using an access
# token obtained from obtain-dev-access-token.ts.
#
# Usage:
#   eval "$(pnpm --filter @apps/public-api smoke:token --print-env)"
#   ./apps/public-api/scripts/smoke-mobile-auth.sh
#
# Env:
#   ACCESS_TOKEN  (required) Bearer token. Set via the eval line above.
#   API_BASE_URL  (optional) Default: http://localhost:4002
#   ORG_ID        (optional) If set, also probes /v1/orgs/$ORG_ID/ping.
#
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:4002}"
: "${ACCESS_TOKEN:?Run: eval \"\$(pnpm --filter @apps/public-api smoke:token --print-env)\"}"

# jq is used to pretty-print responses; fail clearly if it's missing.
if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required (brew install jq)" >&2
  exit 1
fi

AUTH_HEADER="Authorization: Bearer $ACCESS_TOKEN"

echo "== GET /v1/me ==" >&2
curl -sf -H "$AUTH_HEADER" "$API_BASE_URL/v1/me" | jq .

echo "== GET /v1/organizations ==" >&2
curl -sf -H "$AUTH_HEADER" "$API_BASE_URL/v1/organizations" | jq .

# After picking an org locally, set ORG_ID to probe the org-scoped route:
if [[ -n "${ORG_ID:-}" ]]; then
  echo "== GET /v1/orgs/$ORG_ID/ping ==" >&2
  curl -sf -H "$AUTH_HEADER" "$API_BASE_URL/v1/orgs/$ORG_ID/ping" | jq .
else
  echo "(set ORG_ID to also probe /v1/orgs/\$ORG_ID/ping)" >&2
fi

echo "smoke OK" >&2
