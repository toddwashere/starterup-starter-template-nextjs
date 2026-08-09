import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

import { appRunnerRoute53ZoneId } from "./apprunner-route53";

/**
 * Associate an App Runner custom domain and, when `zoneId` is set, manage DNS
 * in Route 53:
 * - `trafficRecord: "cname"` — host is inside an env-apex zone (staging/sandbox)
 * - `trafficRecord: "alias"` — host is the zone apex (production per-host zones)
 */
export function associateAppRunnerCustomDomain(args: {
  name: string;
  domainName: string;
  serviceArn: pulumi.Input<string>;
  /** When set, manage traffic + ACM validation in this hosted zone. */
  zoneId?: pulumi.Input<string>;
  /**
   * How to point the hostname at App Runner. Alias is required when
   * `domainName` is the hosted zone apex (CNAME is not allowed there).
   */
  trafficRecord?: "cname" | "alias";
  /** AWS region of the App Runner service (required for alias targets). */
  region?: string;
}): aws.apprunner.CustomDomainAssociation {
  const association = new aws.apprunner.CustomDomainAssociation(args.name, {
    domainName: args.domainName,
    serviceArn: args.serviceArn,
    enableWwwSubdomain: false,
  });

  if (args.zoneId) {
    const mode = args.trafficRecord ?? "cname";
    if (mode === "alias") {
      const region = args.region;
      if (!region) {
        throw new Error(
          `associateAppRunnerCustomDomain(${args.name}): region is required for alias traffic records`,
        );
      }
      const apprunnerZoneId = appRunnerRoute53ZoneId(region);
      new aws.route53.Record(`${args.name}-alias`, {
        zoneId: args.zoneId,
        name: args.domainName,
        type: "A",
        aliases: [
          {
            name: association.dnsTarget,
            zoneId: apprunnerZoneId,
            evaluateTargetHealth: true,
          },
        ],
        allowOverwrite: true,
      });
    } else {
      new aws.route53.Record(`${args.name}-cname`, {
        zoneId: args.zoneId,
        name: args.domainName,
        type: "CNAME",
        ttl: 300,
        records: [association.dnsTarget],
        allowOverwrite: true,
      });
    }

    // Validation record count is only known after associate; create inside apply
    // (standard ACM / App Runner pattern).
    association.certificateValidationRecords.apply((recs) => {
      for (let i = 0; i < recs.length; i++) {
        const rec = recs[i]!;
        new aws.route53.Record(`${args.name}-acm-${i}`, {
          zoneId: args.zoneId!,
          name: rec.name,
          type: rec.type,
          ttl: 300,
          records: [rec.value],
          allowOverwrite: true,
        });
      }
    });
  }

  return association;
}
