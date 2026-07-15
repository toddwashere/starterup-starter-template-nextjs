# AWS Route 53 Delegation and PgBouncer TLS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each AWS environment a delegated Route 53 zone and a CIDR-restricted PgBouncer hostname with automatically issued, delivered, and renewed public TLS.

**Architecture:** Bootstrap owns the stable delegated hosted zone and operational alert topic. Core resolves that zone, creates an exportable DNS-validated ACM certificate, exports certificate material into a KMS-encrypted secret through Lambda, and starts a TLS-enabled PgBouncer service behind a restricted public NLB. The external root DNS provider requires one NS delegation; subsequent DNS and certificate operations are automated.

**Tech Stack:** TypeScript, Pulumi AWS 7.35+, Route 53, ACM exportable certificates, Lambda, EventBridge, Secrets Manager, KMS, ECS Fargate, NLB, CloudWatch, SNS, Vitest

**Design spec:** [`docs/superpowers/specs/2026-07-14-aws-route53-pgbouncer-tls-design.md`](../specs/2026-07-14-aws-route53-pgbouncer-tls-design.md)

**Scope boundary:** This plan implements the DNS, TLS, ingress, certificate-audit, and renewal controls in the design spec. It does not by itself certify the complete sandbox workload as HIPAA compliant; the remaining core compliance gaps require their own review and implementation plan.

---

## File Structure

### Create

- `infra/shared/aws-pooler-config.ts` — pure domain derivation and canonical IPv4 CIDR parsing.
- `infra/shared/aws-pooler-config.test.ts` — boundary tests for domains, multiple developers, deduplication, and unsafe ranges.
- `infra/aws/core/pooler-endpoint.ts` — pure construction of the TLS-verified pooled database URL.
- `infra/aws/core/pooler-endpoint.test.ts` — protects the custom hostname and `sslmode=verify-full`.
- `infra/aws/core/pooler-certificate-export.ts` — dependency-injected ACM export, PEM conversion, secret update, and ECS rollout handler.
- `infra/aws/core/pooler-certificate-export.test.ts` — success, failure-ordering, and no-secret-return tests.
- `infra/aws/core/pooler-tls.ts` — ACM, Route 53 validation, KMS, secret, Lambda, EventBridge, and SNS/CloudWatch alarm resources.
- `infra/aws/core/pooler-tls.mock.test.ts` — Pulumi resource graph and IAM-scope tests.
- `infra/aws/core/pooler-stack.ts` — compose TLS, PgBouncer, Route 53 alias, renewal wiring, and the Vercel URL secret.
- `infra/aws/core/pooler-stack.mock.test.ts` — verify the cross-module dependency order and custom endpoint exports.

### Modify

- `infra/.env.example` — document root domain and comma-delimited application/developer CIDRs with reserved examples.
- `infra/aws/env.ts` — expose one validated `poolerConfigFromEnv()` adapter.
- `infra/aws/bootstrap/index.ts` — create and protect the environment hosted zone; create the stable alert topic/subscription; export IDs and nameservers; extend deploy permissions.
- `infra/aws/bootstrap/bootstrap.mock.test.ts` — verify zone, alert topic, outputs, and permission changes.
- `infra/aws/core/package.json` — add the three AWS SDK v3 clients serialized into the Lambda callback.
- `infra/aws/core/pnpm-lock.yaml` — lock those dependency additions.
- `infra/aws/core/pgbouncer.ts` — add an NLB security group, CIDR rules, TLS materializer, shared volume, and initial-export dependency.
- `infra/aws/core/pgbouncer.mock.test.ts` — prove restricted ingress and TLS file wiring.
- `infra/aws/core/index.ts` — resolve the delegated zone, build TLS before PgBouncer, create the alias, use the custom endpoint, and export DNS/TLS outputs.
- `.github/workflows/deploy-aws.yml` — pass the three non-secret environment-specific variables to Pulumi.
- `infra/aws/GETTING_STARTED.md` — add the one-time delegation checkpoint and verification commands.
- `infra/aws/README.md` — document ownership, stable application egress, provider examples, renewal, cost, and developer-IP updates.

## Critical Tests

- `infra/shared/aws-pooler-config.test.ts`: derives `sandbox.aws.example.com` and `db.sandbox.aws.example.com`; accepts five comma-delimited `/32` developer addresses; trims and deduplicates; rejects malformed domains, noncanonical CIDRs, IPv6, empty public allowlists, and `0.0.0.0/0`.
- `infra/aws/bootstrap/bootstrap.mock.test.ts`: creates only the current stack's public hosted zone; exports its ID/name/nameservers; creates the alert topic; and grants the deploy role the required Route 53, ACM, KMS, EventBridge, and certificate-automation permissions.
- `infra/aws/core/pooler-certificate-export.test.ts`: converts an ACM encrypted key before writing the secret; writes no secret version on export/conversion failure; never returns private material; and calls ECS only after a successful renewal write.
- `infra/aws/core/pooler-tls.mock.test.ts`: requests `options.export: "ENABLED"`; validates through the delegated zone; encrypts the TLS secret with the new CMK; invokes export after certificate validation; scopes renewal to the certificate; and alarms to the stable SNS topic.
- `infra/aws/core/pooler-stack.mock.test.ts`: orders initial export before ECS startup and renewal wiring after service creation; creates the NLB alias; and returns the custom hostname rather than the generated NLB name.
- `infra/aws/core/pgbouncer.mock.test.ts`: allows every configured application/developer CIDR on the NLB; never allows `0.0.0.0/0`; allows task ingress only from the NLB security group; writes TLS files before PgBouncer starts; mounts them read-only; and retains TLS to RDS.
- `infra/aws/core/pooler-endpoint.test.ts`: builds the secret URL with the custom hostname, port 6432, and `sslmode=verify-full`, never the generated NLB hostname.

## Task 1: Parse and validate reusable pooler DNS configuration

**Files:**

- Create: `infra/shared/aws-pooler-config.ts`
- Create: `infra/shared/aws-pooler-config.test.ts`
- Modify: `infra/aws/env.ts`
- Modify: `infra/.env.example`

- [ ] **Step 1: Write failing parser tests**

Cover the accepted deployment shape and all fail-closed boundaries:

```ts
import { describe, expect, it } from "vitest";
import { resolveAwsPoolerConfig } from "./aws-pooler-config";

describe("resolveAwsPoolerConfig", () => {
  it("derives names and accepts multiple individual addresses", () => {
    expect(
      resolveAwsPoolerConfig("sandbox", {
        rootDomain: "example.com",
        appEgressCidrs: "203.0.113.10/32, 203.0.113.11/32",
        developerCidrs:
          "198.51.100.10/32,198.51.100.11/32,198.51.100.12/32,198.51.100.13/32,198.51.100.14/32",
      }),
    ).toEqual({
      rootDomain: "example.com",
      zoneName: "sandbox.aws.example.com",
      hostname: "db.sandbox.aws.example.com",
      allowedCidrs: [
        { cidr: "203.0.113.10/32", source: "application" },
        { cidr: "203.0.113.11/32", source: "application" },
        { cidr: "198.51.100.10/32", source: "developer" },
        { cidr: "198.51.100.11/32", source: "developer" },
        { cidr: "198.51.100.12/32", source: "developer" },
        { cidr: "198.51.100.13/32", source: "developer" },
        { cidr: "198.51.100.14/32", source: "developer" },
      ],
    });
  });

  it.each([
    ["", "required"],
    ["https://example.com", "domain"],
    ["example.com.", "domain"],
  ])("rejects root domain %j", (rootDomain, message) => {
    expect(() =>
      resolveAwsPoolerConfig("sandbox", {
        rootDomain,
        appEgressCidrs: "203.0.113.10/32",
        developerCidrs: "",
      }),
    ).toThrow(message);
  });

  it.each(["0.0.0.0/0", "203.0.113.7", "203.0.113.7/33", "2001:db8::1/128", "203.0.113.7/24"])(
    "rejects unsafe or noncanonical CIDR %s",
    (cidr) => {
      expect(() =>
        resolveAwsPoolerConfig("sandbox", {
          rootDomain: "example.com",
          appEgressCidrs: cidr,
          developerCidrs: "",
        }),
      ).toThrow();
    },
  );
});
```

- [ ] **Step 2: Run the parser test and confirm it fails**

Run:

```bash
pnpm exec vitest run --config scripts/vitest.config.ts infra/shared/aws-pooler-config.test.ts
```

Expected: FAIL because `aws-pooler-config.ts` does not exist.

- [ ] **Step 3: Implement the pure parser**

Define these public types and function:

```ts
export type PoolerCidrSource = "application" | "developer";

export interface AwsPoolerConfigInput {
  rootDomain: string;
  appEgressCidrs: string;
  developerCidrs: string;
}

export interface AwsPoolerConfig {
  rootDomain: string;
  zoneName: string;
  hostname: string;
  allowedCidrs: Array<{ cidr: string; source: PoolerCidrSource }>;
}

export function resolveAwsPoolerConfig(
  env: "sandbox" | "staging" | "production",
  input: AwsPoolerConfigInput,
): AwsPoolerConfig;
```

Implementation requirements:

- Lowercase and trim the root domain.
- Validate each DNS label, total length, and absence of protocol/path/trailing dot.
- Split each CIDR list on commas, trim, remove blanks, preserve source, and deduplicate by CIDR.
- Parse IPv4 octets and prefix length without adding a dependency.
- Reject host bits outside `/32` by requiring each supplied CIDR to be a canonical network address.
- Reject IPv6 for this first implementation and explicitly reject `0.0.0.0/0`.
- Reject an empty union of application and developer CIDRs.

- [ ] **Step 4: Add the environment adapter and examples**

Add to `infra/aws/env.ts`:

```ts
import { resolveAwsPoolerConfig, type AwsPoolerConfig } from "../shared/aws-pooler-config";

export function poolerConfigFromEnv(env: AwsEnvName): AwsPoolerConfig {
  return resolveAwsPoolerConfig(env, {
    rootDomain: process.env.AWS_DNS_ROOT_DOMAIN ?? "",
    appEgressCidrs: process.env.AWS_POOLER_APP_EGRESS_CIDRS ?? "",
    developerCidrs: process.env.AWS_POOLER_DEVELOPER_CIDRS ?? "",
  });
}
```

Document only reserved example values in `infra/.env.example`:

```bash
# ── AWS delegated DNS + public PgBouncer allowlist ───────────────
# Real values belong only in infra/.env.local. Each individual IPv4 uses /32.
# AWS_DNS_ROOT_DOMAIN="example.com"
# AWS_POOLER_APP_EGRESS_CIDRS="203.0.113.10/32,203.0.113.11/32"
# AWS_POOLER_DEVELOPER_CIDRS="198.51.100.20/32"
```

Do not open or edit `infra/.env.local`. The operator will set the real root
domain there.

- [ ] **Step 5: Run targeted tests and type checks**

```bash
pnpm exec vitest run --config scripts/vitest.config.ts infra/shared/aws-pooler-config.test.ts
pnpm --dir infra/aws/bootstrap exec tsc --noEmit
pnpm --dir infra/aws/core exec tsc --noEmit
```

Expected: all PASS.

## Task 2: Put the delegated zone and alert channel in bootstrap

**Files:**

- Modify: `infra/aws/bootstrap/index.ts`
- Modify: `infra/aws/bootstrap/bootstrap.mock.test.ts`

- [ ] **Step 1: Extend bootstrap mocks with failing zone and alert assertions**

Stub all three new variables before importing bootstrap. Make mocked Route 53
zones return a deterministic `zoneId` and four `nameServers`. Assert:

```ts
expect(zone.inputs.name).toBe("sandbox.aws.example.com");
expect(zone.inputs.comment).toContain("delegated");
expect(topics).toHaveLength(1);
expect(subscriptions[0].inputs.endpoint).toBe("ops@example.com");
expect(await output(infra.hostedZoneName)).toBe("sandbox.aws.example.com");
expect(await output(infra.hostedZoneNameServers)).toHaveLength(4);
```

Update the existing inline-policy count assertion and verify the new deployment
policy includes Route 53 record changes, ACM certificate management/export,
Lambda/EventBridge/CloudWatch/SNS, Secrets Manager, KMS, and ECS service
deployment actions. Continue to assert that the separate central-state policy
is scoped to its exact bucket and KMS alias.

- [ ] **Step 2: Run bootstrap tests and confirm the new assertions fail**

```bash
pnpm --dir infra/aws/bootstrap exec vitest run bootstrap.mock.test.ts
```

Expected: FAIL because no hosted zone, alert topic, or exports exist.

- [ ] **Step 3: Create stable bootstrap resources**

At bootstrap startup, call `poolerConfigFromEnv(stack)` after validating that
`stack` is an `AwsEnvName`. Create:

```ts
const hostedZone = new aws.route53.Zone(
  "delegated-zone",
  {
    name: poolerConfig.zoneName,
    comment: `Public delegated zone for ${stack} AWS resources`,
    tags: baseTags,
  },
  { protect: true },
);

const alertTopic = new aws.sns.Topic("infra-alerts", {
  name: `${namePrefix}-infra-alerts`,
  kmsMasterKeyId: "alias/aws/sns",
  tags: baseTags,
});

if (budgetNotificationEmail) {
  new aws.sns.TopicSubscription("infra-alerts-email", {
    topic: alertTopic.arn,
    protocol: "email",
    endpoint: budgetNotificationEmail,
  });
}
```

Export:

```ts
export const hostedZoneId = hostedZone.zoneId;
export const hostedZoneName = hostedZone.name;
export const hostedZoneNameServers = hostedZone.nameServers;
export const infraAlertTopicArn = alertTopic.arn;
```

Add an inline GitHub deployment policy. Scope Route 53 record operations to
`hostedZone.arn`; scope pass-role to `${namePrefix}-pooler-*`; scope
Secrets Manager, Lambda, CloudWatch, SNS, KMS, ACM, EventBridge, and ECS names
to the environment where AWS supports resource-level permissions. Use `"*"`
only for create/list/describe actions that do not support resource scoping.

- [ ] **Step 4: Run bootstrap tests and type-check**

```bash
pnpm --dir infra/aws/bootstrap exec vitest run bootstrap.mock.test.ts
pnpm --dir infra/aws/bootstrap exec tsc --noEmit
```

Expected: PASS.

## Task 3: Protect construction of the public pooler URL

**Files:**

- Create: `infra/aws/core/pooler-endpoint.ts`
- Create: `infra/aws/core/pooler-endpoint.test.ts`

- [ ] **Step 1: Write the failing endpoint test**

```ts
import { expect, it } from "vitest";
import { buildPoolerDatabaseUrl } from "./pooler-endpoint";

it("uses the custom verified TLS hostname", () => {
  expect(
    buildPoolerDatabaseUrl({
      username: "starter",
      password: "encoded-password",
      hostname: "db.sandbox.aws.example.com",
      database: "starter",
    }),
  ).toBe(
    "postgresql://starter:encoded-password@db.sandbox.aws.example.com:6432/starter?sslmode=verify-full",
  );
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm --dir infra/aws/core exec vitest run pooler-endpoint.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the helper without logging inputs**

```ts
export function buildPoolerDatabaseUrl(args: {
  username: string;
  password: string;
  hostname: string;
  database: string;
}): string {
  return `postgresql://${encodeURIComponent(args.username)}:${encodeURIComponent(
    args.password,
  )}@${args.hostname}:6432/${encodeURIComponent(args.database)}?sslmode=verify-full`;
}
```

- [ ] **Step 4: Run the endpoint test**

```bash
pnpm --dir infra/aws/core exec vitest run pooler-endpoint.test.ts
```

Expected: PASS.

## Task 4: Implement the secret-safe certificate export handler

**Files:**

- Create: `infra/aws/core/pooler-certificate-export.ts`
- Create: `infra/aws/core/pooler-certificate-export.test.ts`
- Modify: `infra/aws/core/package.json`
- Modify: `infra/aws/core/pnpm-lock.yaml`

- [ ] **Step 1: Obtain dependency-change approval, then add AWS SDK clients**

This repository requires confirmation before dependency mutations. After
approval, run:

```bash
pnpm --dir infra/aws/core add @aws-sdk/client-acm @aws-sdk/client-ecs @aws-sdk/client-secrets-manager
```

Expected: `package.json` and the core-local `pnpm-lock.yaml` contain the latest
allowed releases.

- [ ] **Step 2: Write dependency-injected failure-ordering tests**

Define fakes for `exportCertificate`, `putSecretValue`, `updateService`,
`randomPassphrase`, and `decryptPrivateKey`. Assert:

1. Export failure means zero secret writes and zero ECS calls.
2. Key-conversion failure means zero secret writes and zero ECS calls.
3. Initial success writes valid JSON but does not call ECS.
4. Renewal success writes first, then calls ECS with `forceNewDeployment: true`.
5. The returned value contains status metadata only and does not include
   `certificate`, `certificateChain`, `privateKey`, or passphrase values.

- [ ] **Step 3: Run the handler test and confirm it fails**

```bash
pnpm --dir infra/aws/core exec vitest run pooler-certificate-export.test.ts
```

Expected: FAIL because the handler does not exist.

- [ ] **Step 4: Implement the pure operation and Lambda adapter**

Use this event contract:

```ts
export interface PoolerCertificateExportEvent {
  mode: "initial" | "renewal";
  certificateArn: string;
  secretId: string;
  clusterName: string;
  serviceName: string;
}
```

Use dependency injection around this operation:

```ts
export async function exportPoolerCertificate(
  event: PoolerCertificateExportEvent,
  deps: PoolerCertificateExportDependencies,
): Promise<{ updated: true; deployed: boolean }> {
  const passphrase = deps.randomPassphrase();
  const exported = await deps.exportCertificate(event.certificateArn, passphrase);
  const privateKey = deps.decryptPrivateKey(exported.privateKey, passphrase);

  await deps.putSecretValue(
    event.secretId,
    JSON.stringify({
      certificate: exported.certificate,
      certificateChain: exported.certificateChain,
      privateKey,
    }),
  );

  if (event.mode === "renewal") {
    await deps.updateService(event.clusterName, event.serviceName);
  }

  return { updated: true, deployed: event.mode === "renewal" };
}
```

The production adapter must:

- Generate at least 32 random bytes and encode them as a valid ACM passphrase.
- Call `ExportCertificateCommand`.
- Convert the encrypted PKCS#8 PEM with `node:crypto.createPrivateKey`, then
  export an unencrypted PKCS#8 PEM only in Lambda memory.
- Call `PutSecretValueCommand` only after every certificate field and converted
  key are present.
- Call `UpdateServiceCommand({ forceNewDeployment: true })` only in renewal
  mode and only after the secret write succeeds.
- Never log or return PEM values, passwords, database URLs, or secret contents.

- [ ] **Step 5: Run handler tests and type-check**

```bash
pnpm --dir infra/aws/core exec vitest run pooler-certificate-export.test.ts
pnpm --dir infra/aws/core exec tsc --noEmit
```

Expected: PASS.

## Task 5: Build ACM validation, export, renewal, and alarm resources

**Files:**

- Create: `infra/aws/core/pooler-tls.ts`
- Create: `infra/aws/core/pooler-tls.mock.test.ts`

- [ ] **Step 1: Write failing Pulumi mock tests**

Record resource types and assert:

```ts
expect(certificate.inputs.domainName).toBe("db.sandbox.aws.example.com");
expect(certificate.inputs.validationMethod).toBe("DNS");
expect(certificate.inputs.options).toEqual({ export: "ENABLED" });
expect(validationRecord.inputs.zoneId).toBe("ZDELEGATED");
expect(kmsKey.inputs.enableKeyRotation).toBe(true);
expect(secret.inputs.kmsKeyId).toBeDefined();
expect(eventRule.inputs.eventPattern).toContain(certificateArn);
expect(alarm.inputs.alarmActions).toEqual([alertTopicArn]);
```

Also inspect Lambda role policies to prove:

- ACM export is scoped to the certificate.
- secret writes are scoped to the pooler TLS secret.
- KMS use is scoped to the pooler key.
- ECS update is scoped to the deterministic pooler service ARN.

Assert the initial `aws:lambda/invocation:Invocation` depends logically on
certificate validation by receiving the validated certificate ARN and that the
builder returns the invocation resource for ECS dependency wiring.

- [ ] **Step 2: Run the mock test and confirm it fails**

```bash
pnpm --dir infra/aws/core exec vitest run pooler-tls.mock.test.ts
```

Expected: FAIL because `buildPoolerTls` does not exist.

- [ ] **Step 3: Implement `buildPoolerTls`**

Use a focused interface:

```ts
export interface PoolerTlsArgs {
  namePrefix: string;
  region: string;
  accountId: pulumi.Input<string>;
  hostname: string;
  hostedZoneId: pulumi.Input<string>;
  alertTopicArn: pulumi.Input<string>;
  clusterName: string;
  serviceName: string;
  isProduction: boolean;
  tags?: Record<string, string>;
}

export interface PoolerTlsResult {
  certificateArn: pulumi.Output<string>;
  tlsSecretArn: pulumi.Output<string>;
  tlsKmsKeyArn: pulumi.Output<string>;
  alarmName: pulumi.Output<string>;
  initialExport: aws.lambda.Invocation;
  exporterFunction: aws.lambda.CallbackFunction<PoolerCertificateExportEvent, unknown>;
}
```

Create, in dependency order:

1. `aws.acm.Certificate` with exact hostname, DNS validation, transparency
   logging enabled, and `options: { export: "ENABLED" }`.
2. One Route 53 validation CNAME from the certificate's single domain
   validation option.
3. `aws.acm.CertificateValidation`.
4. A rotating KMS key and alias dedicated to pooler TLS material.
5. A Secrets Manager secret encrypted by that key; recovery is seven days in
   production and immediate in sandbox/staging.
6. A least-privilege Lambda execution role and `aws.lambda.CallbackFunction`
   that delegates to `exportPoolerCertificate`.
7. An initial `aws.lambda.Invocation` in `initial` mode, explicitly dependent
   on certificate validation.
8. A CloudWatch Lambda-errors alarm whose `alarmActions` and `okActions` point
   to the deterministic bootstrap SNS topic.

Set Lambda reserved concurrency to `1` so overlapping renewal deliveries cannot
race secret versions. Use a log group with the compliance retention selected
for the environment, and do not emit event payloads containing secret values.

Also export `buildPoolerTlsRenewal()`. It accepts the foundation result plus the
created ECS service resource, then creates the EventBridge rule/target and
Lambda permission for future `ACM Certificate Available` events. Put
`dependsOn: [service]` on the rule. This ordering prevents the certificate's
initial issuance event from trying to redeploy an ECS service that does not yet
exist. Add direct SNS targets for certificate renewal-action-required,
approaching-expiration, expired, and revoked events scoped to this certificate.
Initial DNS validation failures remain visible as failed Pulumi/CI deployments;
ACM does not emit a dedicated initial-validation-failure event.

- [ ] **Step 4: Run mock tests and type-check**

```bash
pnpm --dir infra/aws/core exec vitest run pooler-tls.mock.test.ts
pnpm --dir infra/aws/core exec tsc --noEmit
```

Expected: PASS.

## Task 6: Restrict the NLB and mount certificate files in PgBouncer

**Files:**

- Modify: `infra/aws/core/pgbouncer.ts`
- Modify: `infra/aws/core/pgbouncer.mock.test.ts`

- [ ] **Step 1: Replace open-ingress expectations with failing restricted tests**

Extend `PgBouncerArgs` test input with:

```ts
allowedCidrs: [
  { cidr: "203.0.113.10/32", source: "application" },
  { cidr: "198.51.100.20/32", source: "developer" },
],
tlsSecretArn: "arn:aws:secretsmanager:us-east-2:123456789012:secret:pooler-tls",
tlsKmsKeyArn: "arn:aws:kms:us-east-2:123456789012:key/pooler",
initialTlsExport: mockInvocation,
```

Assert:

- The NLB has a security group.
- Exactly one ingress rule exists per supplied CIDR on port 6432.
- No resource input contains `0.0.0.0/0` as ingress.
- The task security group receives 6432 only from the NLB security group.
- The task definition contains `tls-materializer` and `pgbouncer`.
- The materializer receives certificate fields through ECS `secrets`.
- Both containers mount the same volume; PgBouncer's mount is read-only.
- PgBouncer depends on materializer `SUCCESS`.
- PgBouncer points client cert/key settings to the mounted PEM paths.
- `SERVER_TLS_SSLMODE=require` remains.
- The service depends on the initial Lambda invocation.

- [ ] **Step 2: Run PgBouncer tests and confirm they fail**

```bash
pnpm --dir infra/aws/core exec vitest run pgbouncer.mock.test.ts
```

Expected: FAIL against the current open task security group.

- [ ] **Step 3: Implement NLB-to-task security boundaries**

Create:

- `pgbouncer-nlb-sg` with no inline public ingress.
- One `SecurityGroupRule` per allowlisted CIDR, with a description such as
  `PgBouncer from application egress` or `PgBouncer from developer`.
- NLB egress to the task security group on 6432.
- Task ingress from the NLB security group on 6432.
- Existing task-to-RDS rule on 5432.

Attach the NLB security group at NLB creation. Remove the current
`pooler.publicListener ? ["0.0.0.0/0"] : []` branch completely.

- [ ] **Step 4: Materialize TLS files without placing PEM in task definition**

Grant the execution role access to the TLS secret and TLS KMS key. Add an
ephemeral task volume named `pooler-tls`. Add a nonessential materializer using
the same pinned PgBouncer image with an overridden shell entrypoint. Inject:

```ts
[
  { name: "TLS_CERTIFICATE", valueFrom: `${tlsSecretArn}:certificate::` },
  { name: "TLS_CERTIFICATE_CHAIN", valueFrom: `${tlsSecretArn}:certificateChain::` },
  { name: "TLS_PRIVATE_KEY", valueFrom: `${tlsSecretArn}:privateKey::` },
];
```

Its static command writes `${TLS_CERTIFICATE}${TLS_CERTIFICATE_CHAIN}` to
`/tls/server.crt`, writes `${TLS_PRIVATE_KEY}` to `/tls/server.key`, applies
owner-only key permissions, and exits. Do not interpolate secret values into
Pulumi strings.

Mount `/tls` read-only in PgBouncer and configure:

```ts
{ name: "CLIENT_TLS_SSLMODE", value: "require" },
{ name: "CLIENT_TLS_CERT_FILE", value: "/tls/server.crt" },
{ name: "CLIENT_TLS_KEY_FILE", value: "/tls/server.key" },
{ name: "SERVER_TLS_SSLMODE", value: "require" },
```

Verify the pinned image's runtime user can read the generated files; use the
same image for both containers so numeric UID/GID ownership is consistent.

- [ ] **Step 5: Return DNS inputs and deterministic ECS identifiers**

Extend `PgBouncerResult` with:

```ts
loadBalancerDnsName: pulumi.Output<string>;
loadBalancerZoneId: pulumi.Output<string>;
clusterName: pulumi.Output<string>;
serviceName: pulumi.Output<string>;
```

Keep the listener protocol `TCP`.

- [ ] **Step 6: Run PgBouncer tests and type-check**

```bash
pnpm --dir infra/aws/core exec vitest run pgbouncer.mock.test.ts
pnpm --dir infra/aws/core exec tsc --noEmit
```

Expected: PASS.

## Task 7: Wire DNS, TLS, PgBouncer, and the Vercel secret in core

**Files:**

- Modify: `infra/aws/core/index.ts`
- Modify: `infra/aws/core/pooler-tls.mock.test.ts`
- Modify: `infra/aws/core/pooler-endpoint.test.ts`
- Create: `infra/aws/core/pooler-stack.ts`
- Create: `infra/aws/core/pooler-stack.mock.test.ts`

- [ ] **Step 1: Add a failing integration-oriented mock assertion**

Assert core resolves the exact public zone, creates an alias named
`db.sandbox.aws.example.com`, targets the NLB DNS name/zone ID, and exports:

```ts
poolerHostname;
poolerCertificateArn;
poolerTlsAlarmName;
poolerEndpointOutput;
```

Assert `poolerEndpointOutput` is the custom hostname, not the generated NLB
name.

- [ ] **Step 2: Resolve configuration and stable bootstrap resources**

At core startup:

```ts
const poolerConfig = poolerConfigFromEnv(stack);
let hostedZone: Awaited<ReturnType<typeof aws.route53.getZone>>;
let alertTopic: Awaited<ReturnType<typeof aws.sns.getTopic>>;
try {
  [hostedZone, alertTopic] = await Promise.all([
    aws.route53.getZone({
      name: `${poolerConfig.zoneName}.`,
      privateZone: false,
    }),
    aws.sns.getTopic({ name: `${namePrefix}-infra-alerts` }),
  ]);
} catch (error) {
  throw new Error(
    `Missing ${poolerConfig.zoneName} bootstrap resources. Deploy bootstrap, ` +
      `delegate its nameservers, and retry core. Cause: ${String(error)}`,
  );
}
```

Top-level await is supported by the core package's ES module configuration.
Keep the error free of credentials and secret values.

- [ ] **Step 3: Build resources without a dependency cycle**

Use deterministic names:

```ts
const poolerClusterName = `${namePrefix}-pgbouncer`;
const poolerServiceName = `${namePrefix}-pgbouncer`;
```

Move the orchestration into `buildPoolerStack()` so `index.ts` remains focused.
Build the TLS foundation first with the deterministic names. Pass its secret,
KMS key, and initial invocation into `buildPgBouncer`. After the ECS service
exists, call `buildPoolerTlsRenewal()` and then create:

```ts
new aws.route53.Record("pooler-alias", {
  zoneId: hostedZone.zoneId,
  name: poolerConfig.hostname,
  type: "A",
  aliases: [
    {
      name: pgbouncer.loadBalancerDnsName,
      zoneId: pgbouncer.loadBalancerZoneId,
      evaluateTargetHealth: true,
    },
  ],
});
```

- [ ] **Step 4: Replace NLB-host URL interpolation**

Build the Vercel URL through `buildPoolerDatabaseUrl` inside the existing
secret-propagating `pulumi.all(...).apply(...)`. Mark the resulting output as a
Pulumi secret if propagation is not preserved automatically. The hostname
input is `poolerConfig.hostname`; never use `nlb.dnsName` in the URL.

- [ ] **Step 5: Export non-secret operator outputs**

Export custom hostname, certificate ARN, zone name, and alarm name. Do not
export the URL, private key, database password, or TLS secret content.

- [ ] **Step 6: Run the complete core test suite**

```bash
pnpm --dir infra/aws/core exec vitest run
pnpm --dir infra/aws/core exec tsc --noEmit
```

Expected: PASS.

## Task 8: Pass deployment variables through CI

**Files:**

- Modify: `.github/workflows/deploy-aws.yml`
- Modify: `infra/.env.example`

- [ ] **Step 1: Add environment-scoped GitHub variables**

In the deployment job, expose:

```yaml
AWS_DNS_ROOT_DOMAIN: ${{ vars.AWS_DNS_ROOT_DOMAIN }}
AWS_POOLER_APP_EGRESS_CIDRS: ${{ vars.AWS_POOLER_APP_EGRESS_CIDRS }}
AWS_POOLER_DEVELOPER_CIDRS: ${{ vars.AWS_POOLER_DEVELOPER_CIDRS }}
```

These are GitHub Environment variables, not secrets. Configure distinct values
for `sandbox-aws`, `staging-aws`, and `production-aws`. The workflow must fail
at parser startup if the selected environment omits them.

For the current Vercel deployment, combine every assigned Static IP from the
`dashboard` and `patient-account` projects into
`AWS_POOLER_APP_EGRESS_CIDRS`. Do not add projects that do not connect directly
to PostgreSQL. Background workers hosted in AWS Lambda use private RDS Proxy
connectivity and never contribute public egress CIDRs.

- [ ] **Step 2: Verify workflow formatting and configuration references**

```bash
pnpm exec prettier --config tooling/prettier/index.js --check .github/workflows/deploy-aws.yml infra/.env.example
rg "AWS_DNS_ROOT_DOMAIN|AWS_POOLER_APP_EGRESS_CIDRS|AWS_POOLER_DEVELOPER_CIDRS" .github/workflows/deploy-aws.yml infra/.env.example
```

Expected: formatting PASS and all three names appear in both files.

## Task 9: Document the one-time delegation and recurring operations

**Files:**

- Modify: `infra/aws/GETTING_STARTED.md`
- Modify: `infra/aws/README.md`

- [ ] **Step 1: Add the bootstrap-to-core delegation checkpoint**

Document:

1. Put the real root domain and CIDRs in `infra/.env.local`.
2. Deploy sandbox bootstrap.
3. Read `hostedZoneNameServers`.
4. At the external provider, create one NS record set for
   `sandbox.aws.example.com` containing all four values, substituting the
   operator's uncommitted root domain.
5. Wait for and verify public delegation.
6. Confirm the SNS subscription email once.
7. Deploy core.

Use verification commands that do not expose secrets:

```bash
dig NS sandbox.aws.example.com
dig A db.sandbox.aws.example.com
aws acm list-certificates --profile starter-sandbox --region us-east-2
openssl s_client -starttls postgres \
  -connect db.sandbox.aws.example.com:6432 \
  -servername db.sandbox.aws.example.com
```

Explain that every `example.com` command must be replaced with the operator's
uncommitted `AWS_DNS_ROOT_DOMAIN` value.

- [ ] **Step 2: Document application-host and developer allowlists**

Explain:

- Hosting providers must supply stable outbound addresses; dynamic egress cannot
  be reliably allowlisted.
- The current deployment purchases Vercel Static IPs only for `dashboard` and
  `patient-account`; enter every assigned address as a `/32`.
- Render and other providers work the same way when they expose stable outbound
  addresses.
- Vercel OIDC continues to provide temporary AWS credentials and scoped AWS API
  access, but it does not authenticate PostgreSQL or replace the network
  allowlist.
- Vercel Static IPs use shared infrastructure, so TLS, SCRAM credentials,
  rotation, OIDC scoping, and audit controls remain required.
- Production database credentials must not be exposed to preview deployments.
- Keep Vercel build traffic outside the Static IP path unless a reviewed build
  step genuinely needs database connectivity.
- AWS Lambda workers connect privately through RDS Proxy and require neither
  Static IPs nor public PgBouncer access.
- Multiple developers append comma-delimited `/32` entries.
- A changed residential IP requires editing `AWS_POOLER_DEVELOPER_CIDRS` and
  rerunning core.
- `0.0.0.0/0` is rejected.
- Static IP allowlisting is one control, not proof of HIPAA compliance.
- Database credentials must be rotated through the existing secret-management
  procedure without printing connection URLs or secret values.

- [ ] **Step 3: Document renewal and incident checks**

Include checks for ACM status, Lambda errors, CloudWatch alarm state, current
ECS deployment, and certificate expiration. State explicitly that DNS labels,
tags, logs, and alarms must not contain PHI.

- [ ] **Step 4: Format documentation**

```bash
pnpm exec prettier --config tooling/prettier/index.js --check \
  infra/aws/GETTING_STARTED.md \
  infra/aws/README.md \
  docs/superpowers/specs/2026-07-14-aws-route53-pgbouncer-tls-design.md \
  docs/superpowers/plans/2026-07-14-aws-route53-pgbouncer-tls.md
```

Expected: PASS.

## Task 10: Run static verification and perform the sandbox rollout

**Files:**

- Verify all files above; no additional implementation files.

- [ ] **Step 1: Run focused tests**

```bash
pnpm exec vitest run --config scripts/vitest.config.ts infra/shared/aws-pooler-config.test.ts
pnpm --dir infra/aws/bootstrap exec vitest run
pnpm --dir infra/aws/core exec vitest run
```

Expected: all PASS.

- [ ] **Step 2: Run type, lint, and formatting checks**

```bash
pnpm --dir infra/aws/bootstrap exec tsc --noEmit
pnpm --dir infra/aws/core exec tsc --noEmit
pnpm lint
pnpm format:check
```

Expected: all PASS. If the root Prettier config cannot resolve
`@workspace/tooling`, rerun targeted checks with
`--config tooling/prettier/index.js` and record that repository configuration
issue separately.

- [ ] **Step 3: Configure the two Vercel projects' Static IPs**

Enable Static IPs for the `dashboard` and `patient-account` projects in the
region used for their database-connected functions. Leave build routing
disabled unless a reviewed build step needs database connectivity. Copy every
assigned egress address into `AWS_POOLER_APP_EGRESS_CIDRS` as comma-delimited
`/32` entries in the uncommitted local configuration and the `sandbox-aws`
GitHub Environment variable. Do not add default Vercel or cloud-provider
ranges.

- [ ] **Step 4: Verify identity before previews or updates**

```bash
AWS_PROFILE=starter-sandbox aws sts get-caller-identity
```

Expected: account ID equals `AWS_SANDBOX_ACCOUNT_ID` and ARN is the intended SSO
role. Stop before mutation on any mismatch.

- [ ] **Step 5: Preview and deploy bootstrap**

Use the repository wrapper and existing KMS-backed S3 Pulumi backend:

```bash
pnpm infra:aws preview bootstrap sandbox
pnpm infra:aws up bootstrap sandbox
```

Expected: one public hosted zone and alert topic are created in the sandbox
account. No core resources are created by this command.

- [ ] **Step 6: Stop for the external DNS checkpoint**

Copy all four exported nameservers into the parent provider's NS record for
`sandbox.aws.example.com` after substituting the uncommitted root domain,
confirm the SNS email subscription, and run:

```bash
dig NS sandbox.aws.example.com
```

Expected: the public answer exactly matches the four Route 53 nameservers. Do
not continue until it does.

- [ ] **Step 7: Preview core and inspect security-sensitive changes**

```bash
pnpm infra:aws preview core sandbox
```

Confirm the preview contains:

- One exportable ACM certificate for the exact database hostname.
- No wildcard certificate.
- No `0.0.0.0/0` PgBouncer ingress.
- One NLB ingress rule per configured CIDR.
- No database public-access change.
- One KMS key, TLS secret, exporter Lambda, renewal rule, and alarm.

- [ ] **Step 8: Deploy core**

```bash
pnpm infra:aws up core sandbox
```

Expected: ACM reaches `ISSUED`, the initial exporter invocation succeeds,
PgBouncer reaches steady state, and the Route 53 alias resolves.

- [ ] **Step 9: Verify positive and negative connectivity**

From an allowlisted developer network:

```bash
dig A db.sandbox.aws.example.com
openssl s_client -starttls postgres \
  -connect db.sandbox.aws.example.com:6432 \
  -servername db.sandbox.aws.example.com
```

Then connect with the secret-backed application configuration using
`sslmode=verify-full`. From a non-allowlisted network, the TCP connection must
time out or be rejected before PostgreSQL authentication.

- [ ] **Step 10: Verify renewal observability without exporting key material**

Check the certificate ARN/status, Lambda's error metric, CloudWatch alarm, and
ECS deployment metadata. Do not manually call `ExportCertificate`, print the
secret, or inspect PEM/private-key files.

- [ ] **Step 11: Create task-level commits only when explicitly authorized**

If the user authorizes commits during execution, create small commits after
Tasks 1–2, 3–5, 6–8, and 9–10 using repository-style messages. Otherwise leave
all changes uncommitted for review.
