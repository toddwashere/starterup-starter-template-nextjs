import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

/**
 * Tier 1 CloudWatch alarms for core-owned resources: the SQS queues and RDS.
 *
 * Each alarm notifies at most one of the two SNS topics bootstrap creates:
 * `critical` goes to `{prefix}-infra-alerts`, `warning` to
 * `{prefix}-infra-alerts-warning`, and `silent` children of a composite notify
 * nothing at all (see `AlarmSeverity` below). The pooler TLS exporter alarm
 * draws from the same two topics (pooler-tls.ts).
 * Lambda and App Runner alarms live in `apps/alarms.ts` because those resources
 * belong to the apps stack; the two files share no builders, and each Pulumi
 * program installs its own `@pulumi/aws`, so they are deliberately not merged
 * into one cross-program module.
 *
 * `treatMissingData` is the load-bearing choice in most of these. Count metrics
 * are only published once a non-zero value occurs, so they MUST use
 * `notBreaching` or the alarm parks in INSUFFICIENT_DATA and never evaluates.
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
 * DLQ depth `> 0`.
 *
 * The highest-value alarm in this set: a message in a dead-letter queue always
 * means a job was retried to exhaustion and dropped. There is no benign case,
 * so the threshold is zero rather than a rate.
 */
export function dlqDepthAlarm(
  ctx: AlarmContext,
  opts: { slug: string; dlqName: pulumi.Input<string>; severity: AlarmSeverity },
): aws.cloudwatch.MetricAlarm {
  const name = `${ctx.namePrefix}-${opts.slug}-dlq-not-empty`;
  return new aws.cloudwatch.MetricAlarm(name, {
    name,
    namespace: "AWS/SQS",
    metricName: "ApproximateNumberOfMessagesVisible",
    dimensions: { QueueName: opts.dlqName },
    statistic: "Maximum",
    // SQS publishes queue-depth metrics at 5-minute granularity.
    period: 300,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    comparisonOperator: "GreaterThanThreshold",
    threshold: 0,
    treatMissingData: "notBreaching",
    alarmDescription: `Messages in the ${opts.slug} dead-letter queue — jobs were retried to exhaustion and dropped`,
    ...actions(ctx, opts.severity),
  });
}

/**
 * Oldest-message age on a live queue.
 *
 * Catches a consumer that has stalled *without* throwing — a stuck event source
 * mapping, a throttled Lambda, a poison message being redelivered. An error-count
 * alarm misses all of those, because nothing is erroring.
 */
export function queueBacklogAgeAlarm(
  ctx: AlarmContext,
  opts: {
    slug: string;
    queueName: pulumi.Input<string>;
    severity: AlarmSeverity;
    /** Seconds the oldest message may sit before alarming (default 15 min). */
    thresholdSeconds?: number;
  },
): aws.cloudwatch.MetricAlarm {
  const threshold = opts.thresholdSeconds ?? 900;
  const name = `${ctx.namePrefix}-${opts.slug}-backlog-age`;
  return new aws.cloudwatch.MetricAlarm(name, {
    name,
    namespace: "AWS/SQS",
    metricName: "ApproximateAgeOfOldestMessage",
    dimensions: { QueueName: opts.queueName },
    statistic: "Maximum",
    period: 300,
    // Two consecutive windows: a brief backlog during a burst is not an incident.
    evaluationPeriods: 2,
    datapointsToAlarm: 2,
    comparisonOperator: "GreaterThanThreshold",
    threshold,
    treatMissingData: "notBreaching",
    alarmDescription: `Oldest message on ${opts.slug} is older than ${threshold}s — the consumer is not draining the queue`,
    ...actions(ctx, opts.severity),
  });
}

/**
 * RDS `max_connections` by instance class.
 *
 * Postgres on RDS defaults to `LEAST({DBInstanceClassMemory/9531392}, 5000)`.
 * Only the classes this repo configures are listed; an unknown class skips the
 * connection alarm rather than guessing a wrong threshold.
 */
const RDS_MAX_CONNECTIONS: Record<string, number> = {
  "db.t4g.micro": 112, // 1 GiB
  "db.t4g.small": 225, // 2 GiB
  "db.t4g.medium": 450, // 4 GiB
};

/**
 * RDS saturation alarms: CPU, free storage, and connection count, behind one
 * composite.
 *
 * These three move together — a runaway query raises CPU and connections while
 * a bloated table eats storage — so notifying on each individually turns one
 * event into three messages and three recoveries. The children are `silent`
 * detectors; the composite is the only notifier. Its payload names the child
 * that transitioned, so grouping costs no diagnostic detail.
 *
 * Storage is derived from the configured `allocatedStorage`. Staging and
 * production both allocate 50 GiB today (`config.staging.ts` composes from
 * `productionConfig`), but the threshold stays proportional so a resize does
 * not silently invalidate it.
 */
export function rdsSaturationAlarms(
  ctx: AlarmContext,
  opts: {
    instanceId: pulumi.Input<string>;
    instanceClass: string;
    allocatedStorageGb: number;
    severity: AlarmSeverity;
  },
): { children: aws.cloudwatch.MetricAlarm[]; composite: aws.cloudwatch.CompositeAlarm } {
  const dimensions = { DBInstanceIdentifier: opts.instanceId };
  const children: aws.cloudwatch.MetricAlarm[] = [];
  const childNames: string[] = [];

  const cpuName = `${ctx.namePrefix}-db-cpu-high`;
  childNames.push(cpuName);
  children.push(
    new aws.cloudwatch.MetricAlarm(cpuName, {
      name: cpuName,
      namespace: "AWS/RDS",
      metricName: "CPUUtilization",
      dimensions,
      statistic: "Average",
      period: 300,
      // Sustained load only — one spiky window (vacuum, migration) is not an incident.
      evaluationPeriods: 3,
      datapointsToAlarm: 3,
      comparisonOperator: "GreaterThanThreshold",
      threshold: 80,
      treatMissingData: "missing",
      alarmDescription: "Database CPU above 80% for 15 minutes",
      ...actions(ctx, "silent"),
    }),
  );

  const maxConnections = RDS_MAX_CONNECTIONS[opts.instanceClass];
  if (maxConnections) {
    const connName = `${ctx.namePrefix}-db-connections-high`;
    childNames.push(connName);
    children.push(
      new aws.cloudwatch.MetricAlarm(connName, {
        name: connName,
        namespace: "AWS/RDS",
        metricName: "DatabaseConnections",
        dimensions,
        statistic: "Maximum",
        period: 300,
        evaluationPeriods: 2,
        datapointsToAlarm: 2,
        comparisonOperator: "GreaterThanThreshold",
        // 80% of the class default. RDS Proxy and PgBouncer both hold pools, so
        // nearing this ceiling means a pool is misconfigured, not merely busy.
        threshold: Math.round(maxConnections * 0.8),
        treatMissingData: "missing",
        alarmDescription: `Database connections above 80% of the ${opts.instanceClass} default max (${maxConnections})`,
        ...actions(ctx, "silent"),
      }),
    );
  }

  const storageThresholdBytes = Math.round(
    opts.allocatedStorageGb * 0.1 * 1024 ** 3,
  );
  const storageName = `${ctx.namePrefix}-db-storage-low`;
  childNames.push(storageName);
  children.push(
    new aws.cloudwatch.MetricAlarm(storageName, {
      name: storageName,
      namespace: "AWS/RDS",
      metricName: "FreeStorageSpace",
      dimensions,
      statistic: "Minimum",
      period: 300,
      // 2-of-3: FreeStorageSpace oscillates during vacuum and WAL churn, so a
      // 1-of-1 alarm flaps. At a 10%-of-50-GiB threshold there is far more than
      // ten minutes of headroom, so the hysteresis costs nothing real.
      evaluationPeriods: 3,
      datapointsToAlarm: 2,
      comparisonOperator: "LessThanThreshold",
      threshold: storageThresholdBytes,
      treatMissingData: "missing",
      alarmDescription: `Database free storage below 10% of ${opts.allocatedStorageGb} GiB`,
      ...actions(ctx, "silent"),
    }),
  );

  const compositeName = `${ctx.namePrefix}-database-saturation`;
  const composite = new aws.cloudwatch.CompositeAlarm(
    compositeName,
    {
      alarmName: compositeName,
      // Built from the children actually created: an unlisted instance class
      // skips the connections alarm, and a rule naming a nonexistent alarm is a
      // deploy-time error.
      alarmRule: childNames.map((n) => `ALARM("${n}")`).join(" OR "),
      alarmDescription: "Database saturation: CPU, connections, or free storage",
      ...actions(ctx, opts.severity),
    },
    // The rule references the children by name — plain strings, which Pulumi
    // cannot see as a dependency. Without this edge the engine is free to
    // delete a child in the same update that rewrites the rule (change
    // `instanceClass` to one absent from RDS_MAX_CONNECTIONS and it will), and
    // `pulumi destroy` can attempt a child before the composite that still
    // names it. The provider's own docs call for `dependsOn` here.
    { dependsOn: children },
  );

  return { children, composite };
}
