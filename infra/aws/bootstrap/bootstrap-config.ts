export function validatedGithubRepo(value: string | undefined): string {
  const repo = value?.trim();
  if (!repo) {
    throw new Error("starter-aws-bootstrap:githubRepo is required to scope GitHub OIDC trust.");
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("starter-aws-bootstrap:githubRepo must use owner/repo format.");
  }
  return repo;
}
