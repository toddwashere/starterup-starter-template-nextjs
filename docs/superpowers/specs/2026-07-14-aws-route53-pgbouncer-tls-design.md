# AWS Route 53 Delegation and PgBouncer TLS

**Date:** 2026-07-14  
**Status:** Approved

## Overview

Provision a stable, publicly trusted hostname for each environment's public
PgBouncer endpoint while keeping the repository reusable and minimizing
operator work. The external DNS provider continues to own the root domain.
Each AWS workload account owns a delegated Route 53 subdomain, and Pulumi
automates records, certificate validation, certificate delivery, renewal, and
restricted network access.

The first rollout targets sandbox. The same implementation supports staging and
production without creating those resources until their stacks are deployed.

## Configuration

Deployment-specific values remain outside version control in
`infra/.env.local`. `infra/.env.example` documents placeholders only.

```bash
AWS_DNS_ROOT_DOMAIN=example.com
AWS_POOLER_APP_EGRESS_CIDRS=203.0.113.10/32,203.0.113.11/32
AWS_POOLER_DEVELOPER_CIDRS=198.51.100.20/32
```

For a sandbox deployment using the committed placeholder, the derived values
are:

- Delegated zone: `sandbox.aws.example.com`
- PgBouncer hostname: `db.sandbox.aws.example.com`

The root domain is deployment metadata rather than a secret, but it remains
uncommitted because this repository is a starter template. CIDR variables
accept comma-delimited IPv4 ranges. A single IPv4 address is represented as a
`/32`; therefore, five developers can supply five comma-delimited `/32`
entries. Parsing trims whitespace, rejects malformed or non-IPv4 CIDRs,
deduplicates entries, and requires at least one allowed CIDR whenever the
public pooler is enabled. There is no `0.0.0.0/0` fallback.

Application CIDRs must be stable outbound addresses assigned by the hosting
provider. For example, Vercel Static IPs can supply them; default Vercel egress
is not stable enough. Other providers, such as Render, work the same way when
they provide stable outbound addresses.

## Hosting Decision

The current deployment enables Vercel Static IPs only for the `dashboard` and
`patient-account` projects because those projects require direct Prisma access.
All assigned egress addresses from both projects are added as individual `/32`
entries to `AWS_POOLER_APP_EGRESS_CIDRS`.

Background workers run in AWS Lambda inside the workload VPC and connect
privately through RDS Proxy. They do not require public pooler access or Vercel
Static IPs. Future applications that do not connect directly to PostgreSQL also
do not require entries in the pooler allowlist.

Vercel OIDC remains enabled for temporary AWS credentials and least-privilege
AWS API access. It complements the network allowlist but does not authenticate
PostgreSQL connections or replace TLS and database credentials.

## Resource Ownership

The bootstrap stack owns the public Route 53 hosted zone because bootstrap is
deployed once per workload account and survives core teardown. The zone is
protected against accidental Pulumi deletion. Bootstrap exports:

- Hosted zone ID
- Fully qualified zone name
- Route 53 nameservers

The operator performs one external action per environment: add the exported NS
records at the root domain's current DNS provider. Core derives the same zone
name from the validated environment configuration and resolves the in-account
public zone by name. This avoids cross-account DNS roles and avoids coupling
core to an additional StackReference.

The core stack owns all resources that follow the lifetime of PgBouncer:

- `db.<environment>.aws.<root-domain>` alias record
- Exportable ACM public certificate and DNS validation records
- KMS-encrypted TLS secret
- Certificate export and renewal automation
- NLB, PgBouncer task, and associated security groups

## DNS and Initial Deployment Flow

The sandbox rollout is intentionally two steps:

1. Deploy bootstrap. Pulumi creates the protected
   `sandbox.aws.<root-domain>` hosted zone and prints its nameservers.
2. Add one NS delegation set at the existing external DNS provider.
3. Confirm delegation resolves publicly.
4. Deploy core. Pulumi creates the PgBouncer hostname, ACM DNS validation
   records, certificate, TLS delivery automation, and PgBouncer service in one
   deployment.

Because Route 53 owns the delegated zone, ACM validation and future record
changes require no further registrar work. Staging and production repeat the
same one-time delegation when those environments are introduced.

The database record is a Route 53 alias to the public Network Load Balancer.
Clients connect to the custom hostname, never the generated
`*.elb.amazonaws.com` name.

## TLS Architecture

PostgreSQL negotiates TLS with an in-band SSL request, so an NLB TLS listener
cannot terminate this connection. The NLB remains a TCP pass-through listener,
and PgBouncer terminates client TLS.

Core requests an exportable ACM public certificate for the exact PgBouncer
hostname and validates it through Route 53. A certificate exporter Lambda:

1. Generates an in-memory one-time export passphrase.
2. Calls ACM `ExportCertificate`.
3. Decrypts the returned passphrase-protected private key in memory.
4. Writes the certificate, chain, and private key to one Secrets Manager
   secret encrypted with a rotating customer-managed KMS key.
5. Never returns or logs certificate private material.

An explicit initial Lambda invocation writes the first secret version before
the ECS service starts. An EventBridge rule handles later ACM
certificate-available events. On renewal, the same Lambda replaces the secret
value and forces a rolling PgBouncer ECS deployment so new tasks load the
renewed certificate.

The ECS task includes a nonessential certificate-materializer container. It
receives the three secret JSON fields through ECS secret injection, writes
permission-restricted PEM files to a shared ephemeral task volume, and exits.
The PgBouncer container depends on successful materialization, mounts the
volume read-only, and points its client TLS settings at those files. PgBouncer
continues to require TLS for its connection to RDS.

Clients use:

```text
postgresql://...@db.sandbox.aws.example.com:6432/starter?sslmode=verify-full
```

The Vercel-facing database URL secret uses the custom hostname. Certificate
private material never enters a Pulumi input, output, stack export, or state
value.

## Network Access

The public NLB receives its own security group. It allows TCP port 6432 only
from the union of `AWS_POOLER_APP_EGRESS_CIDRS` and
`AWS_POOLER_DEVELOPER_CIDRS`. Each CIDR becomes a separately described ingress
rule so AWS and Pulumi diffs identify its source class.

The PgBouncer task security group no longer accepts public CIDRs. It accepts
port 6432 only from the NLB security group. The existing database security
group continues to accept port 5432 only from the PgBouncer task security
group. This produces the path:

```text
approved CIDRs -> public NLB:6432 -> PgBouncer:6432 -> private RDS:5432
```

Changing a developer's public IP requires updating the comma-delimited local
variable and redeploying core. Removing a CIDR removes its ingress rule.

## IAM and Secret Boundaries

The deployment identity receives the Route 53, ACM, Lambda, EventBridge, KMS,
Secrets Manager, and ECS permissions needed to manage these resources. Runtime
permissions remain narrower:

- The exporter Lambda can export only the selected ACM certificate, update
  only the pooler TLS secret, use only its KMS key, and redeploy only the
  selected ECS service.
- The ECS execution role can read only the database credential secret and
  pooler TLS secret and decrypt only their applicable KMS keys.
- PgBouncer's application container receives database credentials but does not
  call ACM or Secrets Manager.
- No certificate private material is logged.

When the environment's compliance audit controls are enabled, CloudTrail
records ACM export, Secrets Manager access, KMS use, and deployment actions.

## HIPAA Constraints

DNS names and resource tags must remain generic. They must never contain PHI,
patient identifiers, tenant names, or customer names. Route 53 delegation does
not itself make the data path compliant; every AWS and Vercel service that
stores, processes, or transmits PHI must be covered by the applicable BAA and
configured within that service's HIPAA-eligible scope.

The implementation must:

- Keep certificate keys KMS-encrypted with least-privilege runtime access.
- Audit DNS, certificate, secret, KMS, and deployment control-plane changes.
- Alert on certificate validation, export, and renewal failures.
- Never log database URLs, credentials, certificate private keys, SQL
  parameters, or PHI.
- Require explicit CIDR allowlists, `sslmode=verify-full`, strong database
  authentication, and a documented credential-rotation procedure.
- Keep production database credentials out of Vercel preview deployments and
  avoid routing Vercel build traffic through Static IPs unless a documented
  build step genuinely requires database access.
- Document that production use of the public PgBouncer endpoint requires a
  formal security risk assessment. Vercel Static IPs provide stable egress for
  allowlisting, but they use shared infrastructure and do not, by themselves,
  establish client identity or HIPAA compliance.

## Failure Handling and Operations

- Missing or malformed domain/CIDR configuration fails during program startup,
  before Pulumi registers resources.
- A missing hosted zone produces an explicit message directing the operator to
  deploy bootstrap and complete NS delegation.
- ACM validation failure prevents certificate export and PgBouncer startup.
- Initial certificate export failure prevents the ECS service dependency from
  proceeding.
- Renewal export failure leaves the prior secret version and running tasks
  intact, emits an error metric/log, and triggers an alarm.
- An ECS rollout occurs only after a renewed secret version is written
  successfully.
- The hosted zone is protected, so a routine core teardown does not affect DNS
  delegation.
- Documentation includes commands to verify NS delegation, the ACM certificate,
  the Route 53 alias, the presented certificate, and a PostgreSQL
  `sslmode=verify-full` connection.

## Documentation

`infra/aws/GETTING_STARTED.md` will add a sandbox delegation checkpoint between
bootstrap and core:

1. Configure root domain and CIDRs.
2. Deploy bootstrap.
3. Copy the exported nameservers into the external DNS provider.
4. Verify public NS delegation.
5. Deploy core.
6. Verify DNS, TLS, and CIDR-restricted connectivity.

`infra/aws/README.md` will describe zone ownership, TLS renewal, the Vercel
Static IP requirement, and the recurring developer-IP update procedure.

## Critical Tests

- `infra/shared/aws-pooler-config.test.ts`: derives environment zone and database
  names; parses multiple comma-delimited `/32` entries; trims and deduplicates
  CIDRs; rejects malformed domains, malformed/non-IPv4 CIDRs, empty public
  allowlists, and `0.0.0.0/0`.
- `infra/aws/bootstrap/bootstrap.mock.test.ts`: creates one public hosted zone
  with the derived environment name and exports its ID, name, and nameservers
  without creating staging or production resources from the sandbox stack.
- `infra/aws/core/pooler-tls.mock.test.ts`: creates an exportable,
  DNS-validated ACM certificate; scopes validation records to the delegated
  zone; encrypts the TLS secret with the expected KMS key; wires initial export
  before ECS startup; and scopes renewal events to the selected certificate.
- `infra/aws/core/pooler-certificate-export.test.ts`: writes a new secret
  version only after successful ACM export and private-key conversion; never
  returns private material; leaves the previous version and skips ECS
  deployment on failure; forces deployment only after a successful renewal.
- `infra/aws/core/pgbouncer.mock.test.ts`: creates NLB ingress rules for every
  configured application and developer CIDR; never creates `0.0.0.0/0` ingress;
  restricts task ingress to the NLB security group; materializes TLS files
  before PgBouncer starts; mounts them read-only; and retains TLS on the RDS
  hop.
- `infra/aws/core/pooler-endpoint.test.ts`: builds the Vercel database URL with
  the custom hostname, port 6432, and `sslmode=verify-full`, never the generated
  NLB hostname.

## Verification

- `pnpm type-check`
- `pnpm lint`
- `pnpm format:check`
- Targeted AWS infrastructure Vitest suite
- Pulumi preview for sandbox bootstrap
- Pulumi preview for sandbox core after delegation
- Public NS lookup for `sandbox.aws.<root-domain>`
- TLS handshake and PostgreSQL connection with `sslmode=verify-full`
- Negative connection attempt from a non-allowlisted network
