import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

/**
 * Associate an App Runner custom domain. When `zoneId` is set (staging/sandbox
 * env-apex zone), also create Route 53 CNAME + ACM validation records.
 * Production keeps the apex at the registrar — associate only, then add DNS
 * there from the association outputs.
 */
export function associateAppRunnerCustomDomain(args: {
  name: string;
  domainName: string;
  serviceArn: pulumi.Input<string>;
  /** When set, manage CNAME + ACM validation in this hosted zone. */
  zoneId?: pulumi.Input<string>;
}): aws.apprunner.CustomDomainAssociation {
  const association = new aws.apprunner.CustomDomainAssociation(args.name, {
    domainName: args.domainName,
    serviceArn: args.serviceArn,
    enableWwwSubdomain: false,
  });

  if (args.zoneId) {
    new aws.route53.Record(`${args.name}-cname`, {
      zoneId: args.zoneId,
      name: args.domainName,
      type: "CNAME",
      ttl: 300,
      records: [association.dnsTarget],
      allowOverwrite: true,
    });

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
