# AWS Deployment Identity

**Date:** 2026-07-20  
**Status:** Approved

## Overview

The AWS profile currently hard-codes `starter` into physical resource names,
paths, tags, and cross-account IAM policies. That forces downstream adopters to
maintain a broad rename patch, which makes upstream template updates needlessly
conflict-prone.

This design introduces a single non-secret deployment identity,
`AWS_RESOURCE_PREFIX`. A downstream repository supplies a stable value before
its first deployment (for example, `int-health`). The template uses that value
only where an application identity materially improves uniqueness or operations;
account-local resources retain concise purpose-focused names. Leaving the
setting unset preserves the exact current `starter` behavior.

---

## Configuration and compatibility

`AWS_RESOURCE_PREFIX` accepts 1–29 lowercase letters, numbers, and hyphens,
and must start and end with an alphanumeric character.

Resolution is deliberately backwards-compatible:

1. If `AWS_RESOURCE_PREFIX` is set, use it as the deployment identity.
2. If only legacy `AWS_STATE_RESOURCE_PREFIX` is set, use that value and emit a
   deprecation warning.
3. If neither is set, use `starter`.
4. If both are set to different values, stop before invoking AWS or Pulumi.

The resolved value controls state resources and the selective global or
cross-account naming surfaces below. `AWS_STATE_RESOURCE_PREFIX` remains a
temporary compatibility alias, not a second namespace.

Changing a resolved identity after an environment is deployed is unsupported:
many physical resources would be replaced. The migration guide must require a
new environment or an explicit migration plan for such a change.

## Selective naming policy

Use the deployment identity in names that cross account, service, or public
boundaries:

| Surface | Example with `int-health` / staging | Rationale |
| --- | --- | --- |
| State and audit buckets, state KMS alias and CloudFormation stack | `int-health-staging-<account>-us-east-2` | S3 namespace and central-state operations require clear ownership. |
| Cross-account deployment role and policy ARNs | `int-health-staging-github-deploy` | State-account grants must precisely match workload identity. |
| ECR namespace | `int-health/dashboard` | Registry paths appear in image references and CI artifacts. |
| Public or exported resource names | `int-health-staging-…` | Makes ownership clear beyond a single environment account. |
| Resource tags | `Project=int-health`, `Environment=staging` | Mandatory searchable operational context on every managed resource. |

Keep names concise where the dedicated AWS account already supplies the
application boundary:

| Surface | Example | Rationale |
| --- | --- | --- |
| IAM roles used only inside the workload account | `github-deploy` | Account identity and tags provide sufficient context. |
| ECR repository leaf | `dashboard` | The ECR namespace carries application identity. |
| SQS queues and DLQs | `int-health-jobs-staging`, `int-health-jobs-staging-dlq` | Prefix + purpose + environment; `-dlq` marks dead-letter queues. |
| Secrets Manager paths | `/staging/database-url` | Account and environment partition the secret namespace. |
| CloudWatch log groups | `/staging/apps/dashboard` | Short operational paths remain unambiguous in a dedicated account. |

Pulumi project names, package names, directory layout, stack names, logical
Pulumi resource IDs, and internal database user/database names stay unchanged.
They are template implementation details and must not become downstream
customization points.

## Naming module and IAM invariant

Add one shared AWS naming module that resolves and validates the identity once.
It exposes helpers for global names, local names, tags, ECR paths, secret/log
paths, and the GitHub deploy-role name. Bootstrap, core, apps, and state
bootstrap consume those helpers instead of assembling raw string literals.

Every IAM statement must derive its ARN through the same helper used to create
the resource. This prevents a configuration from creating an `int-health` path
while granting permissions only to the legacy `starter` path.

## Downstream adoption

New downstream deployments set one value in their operator configuration and
GitHub Environment:

```dotenv
AWS_RESOURCE_PREFIX=int-health
```

The template setup guide must show this as the first AWS identity choice. CI
receives it as a non-secret GitHub Environment variable. Existing downstream
repositories can upgrade without setting it and retain `starter` names.

## Critical Tests

- `infra/aws/naming.test.ts`: resolves the canonical setting, defaults to
  `starter`, supports the legacy alias with a warning, and rejects invalid or
  conflicting values.
- `infra/aws/scripts/state-orchestration.test.ts`: state buckets, state stack,
  and cross-account GitHub role ARN share the canonical identity.
- `infra/aws/bootstrap/bootstrap.mock.test.ts`: opt-in identity yields the
  expected ECR namespace, global bootstrap names, and matching IAM policy ARNs;
  default fixtures retain their current values.
- `infra/aws/core/queues.mock.test.ts`: queue and DLQ names use
  `{prefix}-{queue}-{env}[-dlq]` while tags carry the configured project identity.
- `infra/aws/core/manual-secrets.mock.test.ts`: secret paths stay concise and
  environment-scoped while tags carry the configured project identity.
- `infra/aws/apps/apps.mock.test.ts`: image registry resolves the configured
  ECR namespace and app resources receive the canonical tags.

## Verification

- `pnpm --dir infra/aws/bootstrap test`
- `pnpm --dir infra/aws/core test`
- `pnpm --dir infra/aws/apps test`
- `pnpm --dir infra/aws test` when the shared naming tests are placed in the
  nested workspace
- `pnpm lint`
- `pnpm type-check`

