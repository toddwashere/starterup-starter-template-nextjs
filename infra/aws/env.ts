import {
  resolveAwsPoolerConfig,
  resolveAwsPoolerDns,
  type AwsPoolerConfig,
  type AwsPoolerDnsConfig,
} from "../shared/aws-pooler-config";

/**
 * Operator-supplied identifiers for the AWS profile.
 *
 * A starter template must not commit real account ids, org names, or Vercel
 * identifiers, so they come from the environment (define them in the gitignored
 * `infra/.env.local`; see `infra/.env.example`). Load them before running
 * Pulumi, e.g. `set -a && source infra/.env.local && set +a`, or via the
 * `pnpm infra:*` scripts which load `infra/.env.local` automatically.
 *
 * Note: `accountId` is only used for config validation / sanity-checking — the
 * *actual* deploy account is always whatever your AWS credentials point at
 * (compliance resources derive it from `getCallerIdentity` at runtime). Leaving
 * it unset is safe; setting it lets `validateEnvConfig` warn if you're about to
 * deploy to the wrong account.
 */
export type AwsEnvName = "sandbox" | "staging" | "production";

/** Read `AWS_<ENV>_ACCOUNT_ID` from the environment (empty string if unset). */
export function accountIdFromEnv(env: AwsEnvName): string {
  return process.env[`AWS_${env.toUpperCase()}_ACCOUNT_ID`]?.trim() ?? "";
}

/**
 * Vercel OIDC identifiers used to scope the cross-account access role's trust
 * policy. Read from `VERCEL_TEAM_SLUG` / `VERCEL_PROJECT_NAME` (empty when
 * unset — the pooler stays deployable and `validateEnvConfig` warns instead).
 */
export function vercelOidcFromEnv(): { teamSlug: string; projectName: string } {
  return {
    teamSlug: process.env.VERCEL_TEAM_SLUG?.trim() ?? "",
    projectName: process.env.VERCEL_PROJECT_NAME?.trim() ?? "",
  };
}

/**
 * Fully-qualified core `StackReference`
 * (`organization/starter-aws-core/<env>`) built from `PULUMI_ORG`. DIY
 * backends use the literal `organization` org segment.
 */
export function coreStackRefFromEnv(env: AwsEnvName | string): string {
  const org = process.env.PULUMI_ORG?.trim();
  if (!org) {
    throw new Error(
      "PULUMI_ORG is required to resolve the core stack reference " +
        "(organization/starter-aws-core/<env>). Set PULUMI_ORG=organization " +
        "in infra/.env.local.",
    );
  }
  return `${org}/starter-aws-core/${env}`;
}

export function poolerConfigFromEnv(env: AwsEnvName): AwsPoolerConfig {
  return resolveAwsPoolerConfig(env, {
    rootDomain: process.env.AWS_DNS_ROOT_DOMAIN ?? "",
    appEgressCidrs: process.env.AWS_POOLER_APP_EGRESS_CIDRS ?? "",
    developerCidrs: process.env.AWS_POOLER_DEVELOPER_CIDRS ?? "",
  });
}

export function poolerDnsFromEnv(env: AwsEnvName): AwsPoolerDnsConfig {
  return resolveAwsPoolerDns(env, process.env.AWS_DNS_ROOT_DOMAIN ?? "");
}
