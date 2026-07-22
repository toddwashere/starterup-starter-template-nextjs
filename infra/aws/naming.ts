export type AwsEnvironment = "sandbox" | "staging" | "production";

export interface DeploymentIdentity {
  value: string;
  source: "canonical" | "legacy" | "default";
}

export interface DeploymentNames {
  globalPrefix: string;
  ecrNamespace: string;
  secretPathPrefix: string;
  logGroupPrefix: string;
  tags: Record<string, string>;
  deployRoleName: string;
  queueName(name: string, options?: { dlq?: boolean }): string;
}

const PREFIX_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const MAX_PREFIX_LENGTH = 29;
const DEFAULT_IDENTITY = "platform";

function trimEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function validatePrefix(value: string, label: string): void {
  if (!PREFIX_PATTERN.test(value) || value.length > MAX_PREFIX_LENGTH) {
    throw new Error(
      `${label} must be 1-29 lowercase letters, numbers, or hyphens; ` +
        "it must start and end with a letter or number.",
    );
  }
}

/**
 * Resolve the non-secret AWS deployment identity used for state, ECR, tags,
 * queues, and other cross-cutting resource names.
 */
export function resolveDeploymentIdentity(
  env: NodeJS.ProcessEnv,
  warn: (message: string) => void = console.warn,
): DeploymentIdentity {
  const canonical = trimEnv(env.AWS_RESOURCE_PREFIX);
  const legacy = trimEnv(env.AWS_STATE_RESOURCE_PREFIX);

  if (canonical && legacy && canonical !== legacy) {
    throw new Error(
      "AWS_RESOURCE_PREFIX and AWS_STATE_RESOURCE_PREFIX must match when both are set.",
    );
  }

  if (canonical) {
    validatePrefix(canonical, "AWS_RESOURCE_PREFIX");
    return { value: canonical, source: "canonical" };
  }

  if (legacy) {
    validatePrefix(legacy, "AWS_STATE_RESOURCE_PREFIX");
    warn(
      "AWS_STATE_RESOURCE_PREFIX is deprecated; set AWS_RESOURCE_PREFIX instead. " +
        "Using the legacy value for this run.",
    );
    return { value: legacy, source: "legacy" };
  }

  return { value: DEFAULT_IDENTITY, source: "default" };
}

export function deploymentNames(
  identity: DeploymentIdentity,
  environment: AwsEnvironment,
): DeploymentNames {
  return {
    globalPrefix: `${identity.value}-${environment}`,
    ecrNamespace: identity.value,
    secretPathPrefix: `/${environment}`,
    logGroupPrefix: `/${environment}`,
    tags: {
      Project: identity.value,
      Environment: environment,
      ManagedBy: "pulumi",
    },
    deployRoleName: `${identity.value}-${environment}-github-deploy`,
    queueName: (name, options) =>
      `${identity.value}-${name}-${environment}${options?.dlq ? "-dlq" : ""}`,
  };
}
