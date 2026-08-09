import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

/**
 * Slack delivery for the two alert topics, via AWS Chatbot (rebranded "Amazon Q
 * Developer in chat applications").
 *
 * One-time manual prerequisite per AWS account: authorize the Slack workspace
 * in the console under Amazon Q Developer in chat applications → Configure new
 * client → Slack. The OAuth handshake cannot be expressed in IaC. It yields the
 * workspace ID that becomes `slackTeamId`.
 *
 * Absent that config value this builder creates nothing, so a stack that has
 * not been onboarded (sandbox) deploys unchanged.
 */
export interface SlackNotificationArgs {
  namePrefix: string;
  topicArns: Record<"critical" | "warning", pulumi.Input<string>>;
  /** Slack workspace ID from the console authorization. Absent ⇒ no Chatbot. */
  slackTeamId: string | undefined;
  slackChannelId: string | undefined;
  /** Optional. Falls back to `slackChannelId`. */
  slackWarningChannelId: string | undefined;
  tags: Record<string, string>;
}

export interface SlackNotifications {
  critical: aws.chatbot.SlackChannelConfiguration;
  warning: aws.chatbot.SlackChannelConfiguration;
}

export function buildSlackNotifications(
  args: SlackNotificationArgs,
): SlackNotifications | undefined {
  const { namePrefix, topicArns, slackTeamId, slackChannelId, tags } = args;
  if (!slackTeamId || !slackChannelId) return undefined;

  const role = new aws.iam.Role("chatbot-alerts", {
    name: `${namePrefix}-chatbot-alerts`,
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { Service: "chatbot.amazonaws.com" },
          Action: "sts:AssumeRole",
        },
      ],
    }),
    tags,
  });

  // Exactly the metric reads that render an alarm's graph inline in the Slack
  // message, and nothing else. Deliberately NOT the managed
  // `CloudWatchReadOnlyAccess` policy: that one also grants `logs:Get*`,
  // `logs:FilterLogEvents`, `logs:StartQuery` and `logs:StartLiveTail` on
  // `Resource: "*"`. The AWSDenyAll guardrail below blocks all of it today, but
  // relaxing `userAuthorizationRequired` is parked as a future decision, and
  // this role must still be narrow when that decision is made.
  new aws.iam.RolePolicy("chatbot-alerts-cloudwatch", {
    name: `${namePrefix}-chatbot-alerts-cloudwatch`,
    role: role.id,
    policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "MetricReadForAlarmGraphs",
          Effect: "Allow",
          Action: [
            "cloudwatch:GetMetricData",
            "cloudwatch:GetMetricStatistics",
            "cloudwatch:GetMetricWidgetImage",
            "cloudwatch:DescribeAlarms",
            "cloudwatch:ListMetrics",
          ],
          // CloudWatch metrics are not ARN-addressable for these actions.
          Resource: "*",
        },
      ],
    }),
  });

  function channel(
    tier: "critical" | "warning",
    channelId: string,
  ): aws.chatbot.SlackChannelConfiguration {
    return new aws.chatbot.SlackChannelConfiguration(`chatbot-${tier}`, {
      configurationName: `${namePrefix}-${tier}`,
      slackTeamId: slackTeamId!,
      slackChannelId: channelId,
      snsTopicArns: [topicArns[tier]],
      iamRoleArn: role.arn,
      // Notifications flow out; no ChatOps commands flow in. For a
      // HIPAA-adjacent deployment the Slack integration must not become an
      // unaudited path to executing AWS API calls.
      guardrailPolicyArns: ["arn:aws:iam::aws:policy/AWSDenyAll"],
      userAuthorizationRequired: true,
      loggingLevel: "ERROR",
      tags,
    });
  }

  return {
    critical: channel("critical", slackChannelId),
    warning: channel("warning", args.slackWarningChannelId || slackChannelId),
  };
}
