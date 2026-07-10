import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface VercelAccessArgs {
  /** Short prefix used in every Pulumi logical name and AWS resource name. */
  namePrefix: string;
  /** Vercel team slug + project name — used to scope the OIDC trust policy. */
  vercelOidc: { teamSlug: string; projectName: string };
  /** ARN of the uploads bucket (object + bucket ARNs are derived from it). */
  uploadsBucketArn: pulumi.Input<string>;
  /** ARN of the SQS jobs queue Vercel is allowed to produce to. */
  jobsQueueArn: pulumi.Input<string>;
  /** ARNs of the app secrets Vercel may read (e.g. pooled DATABASE_URL). */
  secretArns: pulumi.Input<string>[];
  /** Bedrock region + model ids the InvokeModel grant is scoped to. */
  bedrockRegion: string;
  bedrockModels: string[];
  /** CMEK key ARN when compliance.cmek is on; omitted otherwise. */
  cmekKeyArn?: pulumi.Input<string>;
  tags?: Record<string, string>;
}

export interface VercelAccessResult {
  /** ARN of the role Vercel assumes via OIDC (`AWS_ROLE_ARN` on Vercel). */
  roleArn: pulumi.Output<string>;
  /** ARN of the created OIDC identity provider. */
  oidcProviderArn: pulumi.Output<string>;
}

/**
 * Keyless cross-account access for Vercel-hosted apps.
 *
 * Creates an IAM OIDC identity provider for Vercel and a least-privilege role
 * Vercel assumes via `AssumeRoleWithWebIdentity`. The trust policy is scoped to
 * the caller's Vercel team + project (the `sub` claim), never a wildcard
 * principal. The attached policy grants only what the hybrid needs: the uploads
 * bucket, the jobs queue (produce only), the named app secrets, and Bedrock
 * InvokeModel on the configured models — plus KMS decrypt when CMEK is on.
 *
 * No long-lived access keys are issued.
 */
export function buildVercelAccess(args: VercelAccessArgs): VercelAccessResult {
  const {
    namePrefix,
    vercelOidc,
    uploadsBucketArn,
    jobsQueueArn,
    secretArns,
    bedrockRegion,
    bedrockModels,
    cmekKeyArn,
    tags,
  } = args;

  const { teamSlug, projectName } = vercelOidc;
  const issuerHost = `oidc.vercel.com/${teamSlug}`;

  const oidcProvider = new aws.iam.OpenIdConnectProvider(
    `${namePrefix}-vercel-oidc`,
    {
      url: `https://${issuerHost}`,
      clientIdLists: [`https://vercel.com/${teamSlug}`],
      // AWS validates the OIDC issuer's TLS cert against its trust store; the
      // thumbprint below is a placeholder AWS ignores for well-known IdPs. Pin
      // the live Vercel intermediate thumbprint before production use.
      thumbprintLists: ["9e99a48a9960b14926bb7f3b02e22da2b0ab7280"],
      tags,
    },
  );

  const role = new aws.iam.Role(`${namePrefix}-vercel-access`, {
    name: `${namePrefix}-vercel-access`,
    assumeRolePolicy: oidcProvider.arn.apply((providerArn) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Federated: providerArn },
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: {
                [`${issuerHost}:aud`]: `https://vercel.com/${teamSlug}`,
              },
              // Only this team's project (any environment) may assume the role.
              StringLike: {
                [`${issuerHost}:sub`]: `owner:${teamSlug}:project:${projectName}:environment:*`,
              },
            },
          },
        ],
      }),
    ),
    tags,
  });

  const policyDocument = pulumi
    .all([
      pulumi.output(uploadsBucketArn),
      pulumi.output(jobsQueueArn),
      pulumi.all(secretArns.map((s) => pulumi.output(s))),
      pulumi.output(cmekKeyArn ?? ""),
    ])
    .apply(([bucketArn, queueArn, secrets, cmek]) => {
      const bedrockResources = bedrockModels.map(
        (model) => `arn:aws:bedrock:${bedrockRegion}::foundation-model/${model}`,
      );

      const statements: Record<string, unknown>[] = [
        {
          Sid: "UploadsObjects",
          Effect: "Allow",
          Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
          Resource: `${bucketArn}/*`,
        },
        {
          Sid: "UploadsList",
          Effect: "Allow",
          Action: ["s3:ListBucket"],
          Resource: bucketArn,
        },
        {
          Sid: "JobsProduce",
          Effect: "Allow",
          Action: [
            "sqs:SendMessage",
            "sqs:GetQueueUrl",
            "sqs:GetQueueAttributes",
          ],
          Resource: queueArn,
        },
        {
          Sid: "AppSecretsRead",
          Effect: "Allow",
          Action: ["secretsmanager:GetSecretValue"],
          Resource: secrets,
        },
        {
          Sid: "BedrockInvoke",
          Effect: "Allow",
          Action: [
            "bedrock:InvokeModel",
            "bedrock:InvokeModelWithResponseStream",
          ],
          Resource: bedrockResources,
        },
      ];

      if (cmek) {
        statements.push({
          Sid: "CmekDecrypt",
          Effect: "Allow",
          Action: ["kms:Decrypt", "kms:GenerateDataKey"],
          Resource: cmek,
        });
      }

      return JSON.stringify({ Version: "2012-10-17", Statement: statements });
    });

  new aws.iam.RolePolicy(`${namePrefix}-vercel-access-policy`, {
    role: role.id,
    policy: policyDocument,
  });

  return { roleArn: role.arn, oidcProviderArn: oidcProvider.arn };
}
