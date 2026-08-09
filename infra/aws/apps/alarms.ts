import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

/**
 * Tier 1 CloudWatch alarms for apps-owned resources: the workers Lambda and the
 * App Runner services.
 *
 * Each alarm notifies at most one of the two SNS topics bootstrap creates:
 * `critical` goes to `{prefix}-infra-alerts`, `warning` to
 * `{prefix}-infra-alerts-warning`, and `silent` children of a composite notify
 * nothing at all (see `AlarmSeverity` below). Queue and
 * RDS alarms live in `core/alarms.ts` alongside the resources they watch; the two
 * files share no builders, and each Pulumi program installs its own
 * `@pulumi/aws`, so they are deliberately not merged into a cross-program module.
 */

/**
 * `critical` interrupts a human (email + Slack in production). `warning` is
 * visible but never paging. `silent` is for the children of a composite alarm:
 * they still detect and still show state in the console, but the composite is
 * what notifies, so one underlying event yields one message.
 */
export type AlarmSeverity = "critical" | "warning" | "silent";

export interface AlarmContext {
  namePrefix: string;
  topicArns: Record<"critical" | "warning", pulumi.Input<string>>;
  tags: Record<string, string>;
}

/**
 * Recovery notices are interrupt-grade or nothing. Emailing an OK for a
 * warning doubles the volume to say something stopped being true, which the
 * console already shows.
 */
function actions(ctx: AlarmContext, severity: AlarmSeverity) {
  const notify = severity === "silent" ? undefined : ctx.topicArns[severity];
  return {
    alarmActions: notify ? [notify] : undefined,
    okActions: severity === "critical" ? [ctx.topicArns.critical] : undefined,
    tags: ctx.tags,
  };
}

/**
 * Lambda `Errors > 0` over a five-minute window.
 *
 * This is the alarm that would have caught the workers Lambda failing 100% of
 * its invocations from its first deploy: an init failure such as
 * `Runtime.ImportModuleError` counts as an Error, so a handler that cannot even
 * load still trips it.
 *
 * The window is five minutes rather than one because a one-minute window turns
 * a single sustained fault into a fresh ALARM/OK pair every sixty seconds. The
 * threshold stays at zero — this function should never error.
 *
 * `notBreaching` is required — with no errors, Lambda publishes no datapoints at
 * all, and a `missing`/`breaching` alarm would either sit in INSUFFICIENT_DATA
 * or page constantly on an idle function.
 */
export function lambdaErrorAlarm(
  ctx: AlarmContext,
  opts: {
    slug: string;
    functionName: pulumi.Input<string>;
    description: string;
    severity: AlarmSeverity;
  },
): aws.cloudwatch.MetricAlarm {
  const name = `${ctx.namePrefix}-${opts.slug}-errors`;
  return new aws.cloudwatch.MetricAlarm(name, {
    name,
    namespace: "AWS/Lambda",
    metricName: "Errors",
    dimensions: { FunctionName: opts.functionName },
    statistic: "Sum",
    period: 300,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    comparisonOperator: "GreaterThanThreshold",
    threshold: 0,
    treatMissingData: "notBreaching",
    alarmDescription: opts.description,
    ...actions(ctx, opts.severity),
  });
}

/**
 * Single source of the 5xx alarm name. The composite references its children by
 * name, and the children are created in a loop in `apps/index.ts`, so both
 * sides must derive the name identically or the composite rule dangles.
 */
export function appRunnerServerErrorAlarmName(
  namePrefix: string,
  slug: string,
): string {
  return `${namePrefix}-${slug}-5xx`;
}

/**
 * App Runner 5xx responses.
 *
 * `5xxStatusResponses` does not appear in CloudWatch's metric listing until the
 * first 5xx is emitted, which is exactly why `notBreaching` matters here: a
 * healthy service publishes nothing for this metric.
 */
export function appRunnerServerErrorAlarm(
  ctx: AlarmContext,
  opts: {
    slug: string;
    serviceName: pulumi.Input<string>;
    severity: AlarmSeverity;
    /** 5xx responses in a 5-minute window before alarming (default 5). */
    threshold?: number;
  },
): aws.cloudwatch.MetricAlarm {
  const threshold = opts.threshold ?? 5;
  const name = appRunnerServerErrorAlarmName(ctx.namePrefix, opts.slug);
  return new aws.cloudwatch.MetricAlarm(name, {
    name,
    namespace: "AWS/AppRunner",
    metricName: "5xxStatusResponses",
    dimensions: { ServiceName: opts.serviceName },
    statistic: "Sum",
    period: 300,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    comparisonOperator: "GreaterThanThreshold",
    threshold,
    treatMissingData: "notBreaching",
    alarmDescription: `${opts.slug} returned more than ${threshold} 5xx responses in 5 minutes`,
    ...actions(ctx, opts.severity),
  });
}

/**
 * One composite across every App Runner service's 5xx alarm.
 *
 * A bad deploy, a database failover, or an expired upstream credential takes
 * out all four services at once, so per-service notification turns one incident
 * into four messages and four recoveries. The composite payload names the
 * service that tripped.
 *
 * Takes the alarms themselves, not just their slugs, so the composite can carry
 * a real dependency edge to each child — see `dependsOn` below.
 */
export function appRunnerServerErrorComposite(
  ctx: AlarmContext,
  opts: {
    /** Every deployed service's slug paired with its silent 5xx detector. */
    children: { slug: string; alarm: aws.cloudwatch.MetricAlarm }[];
    severity: AlarmSeverity;
  },
): aws.cloudwatch.CompositeAlarm | undefined {
  // `alarmRule` has a minimum length of 1, so a stack where no app reaches App
  // Runner (every app `deploy: false`) must skip the composite entirely rather
  // than submit an empty rule.
  if (opts.children.length === 0) return undefined;
  const name = `${ctx.namePrefix}-apps-5xx`;
  return new aws.cloudwatch.CompositeAlarm(
    name,
    {
      alarmName: name,
      alarmRule: opts.children
        .map(
          ({ slug }) => `ALARM("${appRunnerServerErrorAlarmName(ctx.namePrefix, slug)}")`,
        )
        .join(" OR "),
      alarmDescription: "One or more App Runner services are returning 5xx responses",
      ...actions(ctx, opts.severity),
    },
    // The rule references the children by name — plain strings, which Pulumi
    // cannot see as a dependency. Without this edge the engine is free to
    // delete a child in the same update that rewrites the rule (set an app to
    // `deploy: false` and it will), and `pulumi destroy` can attempt a child
    // before the composite that still names it. The provider's own docs call
    // for `dependsOn` here.
    { dependsOn: opts.children.map((child) => child.alarm) },
  );
}
