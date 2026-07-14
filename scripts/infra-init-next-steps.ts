export function formatAwsNextSteps(environment: "sandbox" | "production"): string[] {
  return [
    "  1. Create or select the retained central state backend:",
    `     pnpm infra:aws:state init ${environment}`,
    "",
    "  2. Use the printed KMS provider URL to initialize only the layers you choose:",
    `     AWS_PROFILE=starter-${environment} pnpm infra:aws bootstrap stack init ${environment} --secrets-provider='<printed awskms URL>'`,
    `     AWS_PROFILE=starter-${environment} pnpm infra:aws core stack init ${environment} --secrets-provider='<printed awskms URL>'`,
    `     AWS_PROFILE=starter-${environment} pnpm infra:aws apps stack init ${environment} --secrets-provider='<printed awskms URL>'`,
    "",
    "  3. Preview each initialized layer before applying it.",
    "",
    "  See infra/aws/GETTING_STARTED.md for the full account and deploy runbook.",
  ];
}
