/**
 * Operator-supplied identifiers for the AWS profile.
 *
 * A starter template must not commit real account ids, so per-environment
 * account ids come from the environment (define them in the gitignored
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
