export const AWS_ENVIRONMENTS = ["sandbox", "staging", "production"] as const;

export type AwsEnvironment = (typeof AWS_ENVIRONMENTS)[number];

type EnvironmentValues = Record<string, string | undefined>;

export interface StateBootstrapConfig {
  environment: AwsEnvironment;
  region: string;
  ssoRegion: string;
  stateAccountId: string;
  stateProfile: string;
  workloadAccountId: string;
  workloadProfile: string;
  resourcePrefix: string;
}

export interface StateNames {
  stackName: string;
  stateBucketName: string;
  auditBucketName: string;
  kmsAliasName: string;
  trailName: string;
}

const DEFAULT_REGION = "us-east-2";
const ACCOUNT_ID_PATTERN = /^\d{12}$/;
const PREFIX_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function optionValue(argv: readonly string[], name: string): string | undefined {
  const equalsPrefix = `${name}=`;
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === name) return argv[index + 1];
    if (token?.startsWith(equalsPrefix)) return token.slice(equalsPrefix.length);
  }
  return undefined;
}

function required(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}

function validateAccountId(value: string, label: string): void {
  if (!ACCOUNT_ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a 12-digit AWS account ID.`);
  }
}

function validatePrefix(value: string): void {
  if (!PREFIX_PATTERN.test(value) || value.length > 29) {
    throw new Error(
      "AWS_STATE_RESOURCE_PREFIX must be 1-29 lowercase letters, numbers, or hyphens; " +
        "it must start and end with a letter or number.",
    );
  }
}

function parseEnvironment(argv: readonly string[]): AwsEnvironment {
  if (argv[0] !== "init") {
    throw new Error("Usage: pnpm infra:aws:state init <sandbox|staging|production> [options]");
  }
  const value = argv[1];
  if (!(AWS_ENVIRONMENTS as readonly string[]).includes(value ?? "")) {
    throw new Error(
      `Invalid environment "${value ?? ""}". Expected: ${AWS_ENVIRONMENTS.join("|")}`,
    );
  }
  return value as AwsEnvironment;
}

export function resolveStateBootstrapConfig(
  argv: readonly string[],
  env: EnvironmentValues,
): StateBootstrapConfig {
  const environment = parseEnvironment(argv);
  const environmentKey = environment.toUpperCase();
  const region = env.AWS_STATE_REGION?.trim() || DEFAULT_REGION;
  if (region !== DEFAULT_REGION) {
    throw new Error(`AWS_STATE_REGION must be ${DEFAULT_REGION}.`);
  }
  const ssoRegion =
    optionValue(argv, "--sso-region")?.trim() || env.AWS_SSO_REGION?.trim() || region;
  const stateAccountId = required(
    optionValue(argv, "--state-account-id") || env.AWS_STATE_ACCOUNT_ID,
    "AWS_STATE_ACCOUNT_ID",
  );
  const stateProfile = required(
    optionValue(argv, "--state-profile") || env.AWS_STATE_PROFILE,
    "AWS_STATE_PROFILE",
  );
  const workloadAccountId = required(
    optionValue(argv, "--workload-account-id") || env[`AWS_${environmentKey}_ACCOUNT_ID`],
    `AWS_${environmentKey}_ACCOUNT_ID`,
  );
  const workloadProfile = required(
    optionValue(argv, "--workload-profile") ||
      env[`AWS_${environmentKey}_PROFILE`] ||
      `starter-${environment}`,
    `AWS_${environmentKey}_PROFILE`,
  );
  const resourcePrefix = required(
    optionValue(argv, "--resource-prefix") || env.AWS_STATE_RESOURCE_PREFIX,
    "AWS_STATE_RESOURCE_PREFIX",
  );

  validateAccountId(stateAccountId, "AWS_STATE_ACCOUNT_ID");
  validateAccountId(workloadAccountId, `AWS_${environmentKey}_ACCOUNT_ID`);
  validatePrefix(resourcePrefix);
  if (stateAccountId === workloadAccountId) {
    throw new Error("AWS_STATE_ACCOUNT_ID and the workload account ID must differ.");
  }

  const names = stateNames({
    environment,
    resourcePrefix,
    stateAccountId,
    region,
  });
  for (const [label, name] of [
    ["state bucket", names.stateBucketName],
    ["audit bucket", names.auditBucketName],
  ] as const) {
    if (name.length > 63) {
      throw new Error(`Derived ${label} name exceeds 63 characters: ${name}`);
    }
  }

  return {
    environment,
    region,
    ssoRegion,
    stateAccountId,
    stateProfile,
    workloadAccountId,
    workloadProfile,
    resourcePrefix,
  };
}

export function stateNames(input: {
  environment: AwsEnvironment;
  resourcePrefix: string;
  stateAccountId: string;
  region: string;
}): StateNames {
  const { environment, resourcePrefix, stateAccountId, region } = input;
  return {
    stackName: `${resourcePrefix}-${environment}`,
    stateBucketName: `${resourcePrefix}-${environment}-${stateAccountId}-${region}`,
    auditBucketName: `${resourcePrefix}-${environment}-audit-${stateAccountId}`,
    kmsAliasName: `alias/${resourcePrefix}-${environment}`,
    trailName: `${resourcePrefix}-${environment}-access`,
  };
}

export function retentionForEnvironment(environment: AwsEnvironment): {
  stateVersionDays: number;
  auditDays: number;
} {
  return {
    stateVersionDays: environment === "production" ? 365 : 90,
    auditDays: environment === "sandbox" ? 90 : 2190,
  };
}

export function iamRoleArnFromCallerArn(callerArn: string, ssoRegion: string): string {
  if (callerArn.includes(":iam::") && callerArn.includes(":role/")) {
    return callerArn;
  }

  const match = callerArn.match(/^arn:aws:sts::(\d{12}):assumed-role\/([^/]+)\/[^/]+$/);
  if (!match) {
    throw new Error(`Unsupported AWS caller ARN: ${callerArn}`);
  }

  const [, accountId, roleName] = match;
  if (roleName.startsWith("AWSReservedSSO_")) {
    const regionalPath = ssoRegion === "us-east-1" ? "" : `${ssoRegion}/`;
    return `arn:aws:iam::${accountId}:role/aws-reserved/sso.amazonaws.com/${regionalPath}${roleName}`;
  }
  return `arn:aws:iam::${accountId}:role/${roleName}`;
}

export function githubDeployRoleArn(
  workloadAccountId: string,
  environment: AwsEnvironment,
): string {
  return `arn:aws:iam::${workloadAccountId}:role/starter-${environment}-github-deploy`;
}

export function cloudFormationDeployArgs(
  config: StateBootstrapConfig,
  workloadAdminRoleArn: string,
  templatePath: string,
): string[] {
  const names = stateNames(config);
  const retention = retentionForEnvironment(config.environment);
  const githubRoleArn = githubDeployRoleArn(config.workloadAccountId, config.environment);
  const githubRoleName = githubRoleArn.slice(githubRoleArn.lastIndexOf("/") + 1);

  return [
    "cloudformation",
    "deploy",
    "--stack-name",
    names.stackName,
    "--template-file",
    templatePath,
    "--no-fail-on-empty-changeset",
    "--parameter-overrides",
    `Environment=${config.environment}`,
    `ResourcePrefix=${config.resourcePrefix}`,
    `StateBucketName=${names.stateBucketName}`,
    `AuditBucketName=${names.auditBucketName}`,
    `KmsAliasName=${names.kmsAliasName}`,
    `TrailName=${names.trailName}`,
    `WorkloadAccountId=${config.workloadAccountId}`,
    `WorkloadAdminRoleArn=${workloadAdminRoleArn}`,
    `GithubDeployRoleName=${githubRoleName}`,
    `StateVersionRetentionDays=${retention.stateVersionDays}`,
    `AuditRetentionDays=${retention.auditDays}`,
    "--tags",
    `Project=${config.resourcePrefix}`,
    `Environment=${config.environment}`,
    "ManagedBy=CloudFormation",
  ];
}

export function backendUrl(bucketName: string, region: string): string {
  return `s3://${bucketName}?region=${region}&awssdk=v2`;
}

export function secretsProviderUrl(keyArn: string, region: string): string {
  return `awskms:///${keyArn}?region=${region}&awssdk=v2`;
}

export function nextCommands(input: {
  environment: AwsEnvironment;
  workloadProfile: string;
  secretsProvider: string;
}): string {
  const { environment, workloadProfile, secretsProvider } = input;
  const prefix = `AWS_PROFILE=${workloadProfile} pnpm infra:aws`;
  return [
    "Initialize only the layers you intend to deploy:",
    `${prefix} bootstrap stack init ${environment} --secrets-provider='${secretsProvider}'`,
    `${prefix} bootstrap preview -s ${environment}`,
    `${prefix} bootstrap up -s ${environment}`,
    "",
    `${prefix} core stack init ${environment} --secrets-provider='${secretsProvider}'`,
    `${prefix} core preview -s ${environment}`,
    `${prefix} core up -s ${environment}`,
    "",
    `${prefix} apps stack init ${environment} --secrets-provider='${secretsProvider}'`,
    `${prefix} apps preview -s ${environment}`,
    `${prefix} apps up -s ${environment}`,
  ].join("\n");
}
