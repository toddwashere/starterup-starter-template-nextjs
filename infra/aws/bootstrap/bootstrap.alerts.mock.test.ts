import { describe, it, expect, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";

interface RecordedResource {
  type: string;
  name: string;
  inputs: Record<string, unknown>;
}

const recorded: RecordedResource[] = [];
const warnings: string[] = [];

async function build(
  stack: "sandbox" | "staging" | "production",
  extraConfig: Record<string, string> = {},
) {
  vi.resetModules();
  recorded.length = 0;
  warnings.length = 0;
  // `pulumi.log.warn` falls through to console.warn with no engine attached;
  // capture it so the "nobody is subscribed" diagnostic can be asserted.
  vi.spyOn(pulumi.log, "warn").mockImplementation((msg: string) => {
    warnings.push(msg);
    return Promise.resolve();
  });
  vi.stubEnv("AWS_RESOURCE_PREFIX", "");
  vi.stubEnv("AWS_STATE_RESOURCE_PREFIX", "");
  vi.stubEnv("AWS_STATE_ACCOUNT_ID", "444455556666");
  vi.stubEnv("AWS_DNS_ROOT_DOMAIN", "example.com");
  vi.stubEnv("AWS_POOLER_APP_EGRESS_CIDRS", "");
  vi.stubEnv("AWS_POOLER_DEVELOPER_CIDRS", "");
  pulumi.runtime.setMocks(
    {
      newResource: (args) => {
        recorded.push({ type: args.type, name: args.name, inputs: args.inputs });
        const state: Record<string, unknown> = {
          ...args.inputs,
          arn: `arn:aws:iam::123456789012:${args.name}`,
        };
        if (args.type === "aws:sns/topic:Topic") {
          state.arn = `arn:aws:sns:us-east-2:123456789012:${args.inputs.name}`;
        }
        return { id: `${args.name}-id`, state };
      },
      call: (args) => {
        if (args.token.includes("getCallerIdentity")) {
          return { accountId: "123456789012", arn: "arn:aws:iam::123456789012:user/test", userId: "test" };
        }
        return args.inputs;
      },
    },
    "starter-aws-bootstrap",
    stack,
  );
  pulumi.runtime.setAllConfig({
    "aws:region": "us-east-2",
    "starter-aws-bootstrap:githubRepo": "acme/starter",
    "starter-aws-bootstrap:budgetAmount": "100",
    "starter-aws-bootstrap:budgetNotificationEmail": "ops@example.com",
    "starter-aws-bootstrap:complianceMode": "none",
    ...extraConfig,
  });
  await import("./index");
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
}

function topicNames() {
  return recorded
    .filter((r) => r.type === "aws:sns/topic:Topic")
    .map((r) => r.inputs.name as string)
    .sort();
}

function emailSubscriptions() {
  return recorded.filter(
    (r) =>
      r.type === "aws:sns/topicSubscription:TopicSubscription" &&
      r.inputs.protocol === "email",
  );
}

describe("bootstrap alert topics (mocked)", () => {
  it("creates both a critical and a warning topic in production", async () => {
    await build("production");
    expect(topicNames()).toEqual([
      "platform-production-infra-alerts",
      "platform-production-infra-alerts-warning",
    ]);
  }, 20000);

  it("subscribes email to the critical topic only, in production only", async () => {
    await build("production");
    const subs = emailSubscriptions();
    expect(subs).toHaveLength(1);
    expect(subs[0].inputs.endpoint).toBe("ops@example.com");
    const arn = await new Promise<string>((res) =>
      pulumi.output(subs[0].inputs.topic as string).apply(res),
    );
    expect(arn).toBe(
      "arn:aws:sns:us-east-2:123456789012:platform-production-infra-alerts",
    );
  }, 20000);

  it("creates both topics but no email subscription in staging", async () => {
    await build("staging");
    expect(topicNames()).toEqual([
      "platform-staging-infra-alerts",
      "platform-staging-infra-alerts-warning",
    ]);
    expect(emailSubscriptions()).toHaveLength(0);
  }, 20000);

  it("still creates the budget with its own email subscribers in staging", async () => {
    await build("staging");
    const budgets = recorded.filter((r) => r.type === "aws:budgets/budget:Budget");
    expect(budgets).toHaveLength(1);
    const notifications = budgets[0].inputs.notifications as Array<{
      subscriberEmailAddresses: string[];
    }>;
    expect(notifications[0].subscriberEmailAddresses).toEqual(["ops@example.com"]);
  }, 20000);

  it("scopes the warning topic policy to its own ARN", async () => {
    await build("production");
    const policies = recorded.filter((r) => r.type === "aws:sns/topicPolicy:TopicPolicy");
    expect(policies).toHaveLength(2);
    const docs = await Promise.all(
      policies.map(
        (p) =>
          new Promise<string>((res) => pulumi.output(p.inputs.policy as string).apply(res)),
      ),
    );
    const warning = docs.find((d) => d.includes("infra-alerts-warning"));
    expect(warning).toBeDefined();
    // The warning policy must not grant publish to the critical topic's ARN.
    expect(warning).not.toContain('"arn:aws:sns:us-east-2:123456789012:platform-production-infra-alerts"');
    expect(warning).toContain("cloudwatch.amazonaws.com");
  }, 20000);

  it("warns that both topics are unsubscribed when staging has no Slack workspace", async () => {
    await build("staging");
    const warning = warnings.find((w) => w.includes("slackTeamId"));
    // Staging has no email subscription either, so this state is total silence.
    expect(warning).toBeDefined();
    expect(warning).toContain("warning topic will have no subscribers");
    expect(warning).toContain("neither will the critical topic");
  }, 20000);

  it("warns only about the warning topic in production, where email still lands", async () => {
    await build("production");
    const warning = warnings.find((w) => w.includes("slackTeamId"));
    expect(warning).toBeDefined();
    expect(warning).toContain("warning topic will have no subscribers");
    expect(warning).not.toContain("neither will the critical topic");
  }, 20000);

  it("rejects a workspace configured without a channel", async () => {
    // Always operator error, and otherwise a silent no-op: buildSlackNotifications
    // would return undefined and the stack would deploy looking healthy.
    await expect(
      build("staging", { "starter-aws-bootstrap:slackTeamId": "T012AB3CD" }),
    ).rejects.toThrow("slackChannelId is required when slackTeamId is set.");
  }, 20000);

  it("does not warn once a Slack workspace and channel are configured", async () => {
    await build("staging", {
      "starter-aws-bootstrap:slackTeamId": "T012AB3CD",
      "starter-aws-bootstrap:slackChannelId": "C0123CRIT",
    });
    expect(warnings.filter((w) => w.includes("slackTeamId"))).toHaveLength(0);
  }, 20000);

  it("permits SNS to use the shared KMS key for both the critical and warning topics", async () => {
    await build("production");
    const keys = recorded.filter((r) => r.type === "aws:kms/key:Key");
    expect(keys).toHaveLength(1);
    const policy = await new Promise<string>((res) =>
      pulumi.output(keys[0].inputs.policy as string).apply(res),
    );
    const parsed = JSON.parse(policy) as {
      Statement: Array<{ Sid: string; Condition?: Record<string, unknown> }>;
    };
    const snsStatement = parsed.Statement.find(
      (s) => s.Sid === "AllowSnsTopicEncryption",
    );
    expect(snsStatement).toBeDefined();
    // Must not be pinned to the critical topic ARN only via StringEquals.
    expect(
      (snsStatement?.Condition?.StringEquals as Record<string, unknown> | undefined)?.[
        "aws:SourceArn"
      ],
    ).toBeUndefined();
    const arnLike = snsStatement?.Condition?.ArnLike as Record<string, string> | undefined;
    expect(arnLike?.["aws:SourceArn"]).toBe(
      "arn:aws:sns:us-east-2:123456789012:platform-production-infra-alerts*",
    );
    expect(
      (snsStatement?.Condition?.StringEquals as Record<string, unknown> | undefined)?.[
        "aws:SourceAccount"
      ],
    ).toBe("123456789012");
  }, 20000);
});
