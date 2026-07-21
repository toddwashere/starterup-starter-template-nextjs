import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { awsCatalogAppSecrets, awsCatalogPlaceholderSeed } from "../../shared/aws-catalog-secrets";

/**
 * Operator-filled Secrets Manager placeholders, one per `SECRET_CATALOG` entry
 * except `database-url` (which `core/index.ts` derives and populates itself).
 *
 * Each entry becomes an empty-ish `/<environment>/<id>` Secrets Manager secret
 * seeded with a placeholder string. You set the real value once in the AWS
 * console/CLI after `pulumi up`:
 *
 *   aws secretsmanager put-secret-value \
 *     --secret-id /sandbox/stripe-secret-key --secret-string 'sk_live_…'
 *
 * `ignoreChanges: ["secretString"]` on the placeholder version means Pulumi
 * never overwrites the value you set — so **real secret values never live in
 * git**, and re-running `pulumi up` won't clobber them.
 *
 * These are distinct from the connection-string secrets (`database-url`,
 * `direct-url`), which Pulumi derives and populates automatically in
 * `core/index.ts`.
 */
export interface BuiltManualSecret {
  name: string;
  arn: pulumi.Output<string>;
}

export function buildCatalogPlaceholderSecrets(opts: {
  secretPathPrefix: string;
  isProduction: boolean;
  cmekKeyId?: pulumi.Output<string>;
  tags: Record<string, string>;
}): BuiltManualSecret[] {
  const { secretPathPrefix, isProduction, cmekKeyId, tags } = opts;

  return awsCatalogAppSecrets().map((spec) => {
    const secret = new aws.secretsmanager.Secret(`manual-${spec.id}`, {
      name: `${secretPathPrefix}/${spec.id}`,
      description: `App secret ${spec.envVar} (${spec.id}) — set via put-secret-value`,
      // Non-prod: 0 = delete immediately so the name can be re-created on the
      // next deploy. Prod: 7-day recovery window.
      recoveryWindowInDays: isProduction ? 7 : 0,
      kmsKeyId: cmekKeyId,
      tags,
    });

    // Seed a placeholder so the secret has a readable value immediately, then
    // stop tracking the value so console/CLI edits stick.
    new aws.secretsmanager.SecretVersion(
      `manual-${spec.id}-placeholder`,
      {
        secretId: secret.id,
        secretString: awsCatalogPlaceholderSeed(spec.id),
      },
      { ignoreChanges: ["secretString"] },
    );

    return { name: spec.id, arn: secret.arn };
  });
}
