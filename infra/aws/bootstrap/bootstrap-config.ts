export function validatedGithubRepo(
  value: string | undefined,
  configKey = "githubRepo",
): string {
  const repo = value?.trim();
  if (!repo) {
    throw new Error(
      `starter-aws-bootstrap:${configKey} is required to scope GitHub OIDC trust.`,
    );
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error(
      `starter-aws-bootstrap:${configKey} must use owner/repo format.`,
    );
  }
  return repo;
}

/**
 * Build the AssumeRoleWithWebIdentity trust document for the narrow
 * app-release role assumed by this repo's "Release AWS apps" workflow.
 *
 * Scoped by `environment:` claim (not `ref:`) on purpose: the GitHub
 * Environment is the approval boundary, so a push to an arbitrary branch
 * cannot mint release credentials even via workflow_dispatch.
 */
export function buildAppReleaseAssumeRolePolicy(args: {
  providerArn: string;
  /** This repo, `owner/repo`. */
  githubRepo: string;
  /** Pulumi stack / env name: staging | production */
  environment: "staging" | "production";
}): string {
  const { providerArn, githubRepo, environment } = args;
  const githubEnv = `${environment}-aws`;
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Federated: providerArn },
        Action: "sts:AssumeRoleWithWebIdentity",
        Condition: {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub": `repo:${githubRepo}:environment:${githubEnv}`,
          },
        },
      },
    ],
  });
}
