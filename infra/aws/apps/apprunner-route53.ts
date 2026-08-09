/**
 * Route 53 hosted zone IDs for App Runner alias targets (per region).
 * Source: https://docs.aws.amazon.com/general/latest/gr/apprunner.html
 */
export const APP_RUNNER_ROUTE53_ZONE_IDS: Record<string, string> = {
  "us-east-1": "Z01915732ZBZKC8D32TPT",
  "us-east-2": "Z0224347AD7KVHMLOX31",
  "us-west-2": "Z02243383FTQ64HJ5772Q",
  "ap-south-1": "Z00855883LBHKTIC4ODF2",
  "ap-southeast-1": "Z09819469CZ3KQ8PWMCL",
  "ap-southeast-2": "Z03657752RA8799S0TI5I",
  "ap-northeast-1": "Z08491812XW6IPYLR6CCA",
  "eu-central-1": "Z0334911C2FDI2Q9M4FZ",
  "eu-west-1": "Z087551914Z2PCAU0QHMW",
  "eu-west-2": "Z098228427VC6B3IX76ON",
  "eu-west-3": "Z087117439MBKHYM69QS6",
};

export function appRunnerRoute53ZoneId(region: string): string {
  const zoneId = APP_RUNNER_ROUTE53_ZONE_IDS[region];
  if (!zoneId) {
    throw new Error(
      `No App Runner Route 53 hosted zone ID mapped for region ${region}. ` +
        "Add it to APP_RUNNER_ROUTE53_ZONE_IDS (see AWS App Runner endpoints docs).",
    );
  }
  return zoneId;
}
