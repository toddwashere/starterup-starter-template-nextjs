import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

/**
 * Manually-managed secrets registry.
 *
 * Some secrets can't be derived by Pulumi (third-party API keys, webhook signing
 * secrets, etc.). List them here and Pulumi will create an **empty placeholder**
 * Secrets Manager entry named `/starter/<stack>/<name>`. You then set the real
 * value once in the AWS console/CLI after `pulumi up`:
 *
 *   aws secretsmanager put-secret-value \
 *     --secret-id /starter/sandbox/stripe-secret-key --secret-string 'sk_live_…'
 *
 * `ignoreChanges: ["secretString"]` on the placeholder version means Pulumi never
 * overwrites the value you set — so **real secret values never live in git**, and
 * re-running `pulumi up` won't clobber them.
 *
 * These are distinct from the connection-string secrets (`database-url`, etc.),
 * which Pulumi derives and populates automatically in `core/index.ts`.
 */
export interface ManualSecretSpec {
  /** Suffix of the secret name: `/starter/<stack>/<name>`. */
  name: string;
  /** Human-readable description shown in the console. */
  description: string;
}

export const MANUAL_SECRETS: readonly ManualSecretSpec[] = [
  // Add entries as the app needs them, e.g.:
  // { name: "stripe-secret-key", description: "Stripe secret API key" },
  // { name: "resend-api-key", description: "Resend transactional email API key" },
];

export interface BuiltManualSecret {
  name: string;
  arn: pulumi.Output<string>;
}

/**
 * Create an empty placeholder Secrets Manager entry for each spec (defaults to
 * {@link MANUAL_SECRETS}). Returns the created secret names + ARNs.
 */
export function buildManualSecrets(opts: {
  stack: string;
  isProduction: boolean;
  cmekKeyId?: pulumi.Output<string>;
  tags: Record<string, string>;
  specs?: readonly ManualSecretSpec[];
}): BuiltManualSecret[] {
  const { stack, isProduction, cmekKeyId, tags } = opts;
  const specs = opts.specs ?? MANUAL_SECRETS;

  return specs.map((spec) => {
    const secret = new aws.secretsmanager.Secret(`manual-${spec.name}`, {
      name: `/starter/${stack}/${spec.name}`,
      description: spec.description,
      // Non-prod: 0 = delete immediately so the name can be re-created on the
      // next deploy. Prod: 7-day recovery window.
      recoveryWindowInDays: isProduction ? 7 : 0,
      kmsKeyId: cmekKeyId,
      tags,
    });

    // Seed a placeholder so the secret has a readable value immediately, then
    // stop tracking the value so console/CLI edits stick.
    new aws.secretsmanager.SecretVersion(
      `manual-${spec.name}-placeholder`,
      {
        secretId: secret.id,
        secretString: JSON.stringify({ placeholder: "REPLACE_IN_CONSOLE" }),
      },
      { ignoreChanges: ["secretString"] },
    );

    return { name: spec.name, arn: secret.arn };
  });
}
