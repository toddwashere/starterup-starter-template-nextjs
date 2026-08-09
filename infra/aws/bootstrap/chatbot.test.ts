import { describe, it, expect, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";

interface RecordedResource {
  type: string;
  name: string;
  inputs: Record<string, unknown>;
}

const recorded: RecordedResource[] = [];

// Pulumi's mock `newResource` fires asynchronously even behind a nominally
// synchronous resource constructor, so every other *.mock.test.ts in this
// package waits a beat before asserting on `recorded`. Match that convention.
function flush() {
  return new Promise<void>((resolve) => setTimeout(resolve, 100));
}

async function load() {
  vi.resetModules();
  recorded.length = 0;
  pulumi.runtime.setMocks(
    {
      newResource: (args) => {
        recorded.push({ type: args.type, name: args.name, inputs: args.inputs });
        return {
          id: `${args.name}-id`,
          state: { ...args.inputs, arn: `arn:aws:iam::123456789012:role/${args.name}` },
        };
      },
      call: (args) => args.inputs,
    },
    "test-project",
    "test",
  );
  return await import("./chatbot.js");
}

const topics = {
  critical: "arn:aws:sns:us-east-2:123456789012:starter-test-infra-alerts",
  warning: "arn:aws:sns:us-east-2:123456789012:starter-test-infra-alerts-warning",
};

describe("buildSlackNotifications", () => {
  it("creates nothing when no workspace is configured", async () => {
    const mod = await load();
    const result = mod.buildSlackNotifications({
      namePrefix: "starter-test",
      topicArns: topics,
      slackTeamId: undefined,
      slackChannelId: undefined,
      slackWarningChannelId: undefined,
      tags: {},
    });
    await flush();
    expect(result).toBeUndefined();
    expect(recorded).toHaveLength(0);
  });

  it("creates one configuration per tier wired to that tier's topic", async () => {
    const mod = await load();
    mod.buildSlackNotifications({
      namePrefix: "starter-test",
      topicArns: topics,
      slackTeamId: "T012AB3CD",
      slackChannelId: "C0123CRIT",
      slackWarningChannelId: "C0456WARN",
      tags: {},
    });
    await flush();
    const configs = recorded.filter(
      (r) => r.type === "aws:chatbot/slackChannelConfiguration:SlackChannelConfiguration",
    );
    expect(configs).toHaveLength(2);
    const critical = configs.find((c) => c.inputs.slackChannelId === "C0123CRIT");
    const warning = configs.find((c) => c.inputs.slackChannelId === "C0456WARN");
    expect(critical!.inputs.snsTopicArns).toEqual([topics.critical]);
    expect(warning!.inputs.snsTopicArns).toEqual([topics.warning]);
    expect(critical!.inputs.slackTeamId).toBe("T012AB3CD");
  });

  it("falls back to the critical channel when no warning channel is set", async () => {
    const mod = await load();
    mod.buildSlackNotifications({
      namePrefix: "starter-test",
      topicArns: topics,
      slackTeamId: "T012AB3CD",
      slackChannelId: "C0123CRIT",
      slackWarningChannelId: undefined,
      tags: {},
    });
    await flush();
    const configs = recorded.filter(
      (r) => r.type === "aws:chatbot/slackChannelConfiguration:SlackChannelConfiguration",
    );
    expect(configs).toHaveLength(2);
    for (const config of configs) {
      expect(config.inputs.slackChannelId).toBe("C0123CRIT");
    }
  });

  it("denies every action so Slack cannot execute AWS commands", async () => {
    const mod = await load();
    mod.buildSlackNotifications({
      namePrefix: "starter-test",
      topicArns: topics,
      slackTeamId: "T012AB3CD",
      slackChannelId: "C0123CRIT",
      slackWarningChannelId: undefined,
      tags: {},
    });
    await flush();
    const configs = recorded.filter(
      (r) => r.type === "aws:chatbot/slackChannelConfiguration:SlackChannelConfiguration",
    );
    for (const config of configs) {
      expect(config.inputs.guardrailPolicyArns).toEqual([
        "arn:aws:iam::aws:policy/AWSDenyAll",
      ]);
      expect(config.inputs.userAuthorizationRequired).toBe(true);
    }
  });

  it("wires the warning tier to the same Slack workspace", async () => {
    const mod = await load();
    mod.buildSlackNotifications({
      namePrefix: "starter-test",
      topicArns: topics,
      slackTeamId: "T012AB3CD",
      slackChannelId: "C0123CRIT",
      slackWarningChannelId: "C0456WARN",
      tags: {},
    });
    await flush();
    const warning = recorded.find(
      (r) =>
        r.type === "aws:chatbot/slackChannelConfiguration:SlackChannelConfiguration" &&
        r.inputs.slackChannelId === "C0456WARN",
    );
    expect(warning).toBeDefined();
    expect(warning!.inputs.slackTeamId).toBe("T012AB3CD");
  });

  it("grants the Chatbot role metric reads only — never log access", async () => {
    const mod = await load();
    mod.buildSlackNotifications({
      namePrefix: "starter-test",
      topicArns: topics,
      slackTeamId: "T012AB3CD",
      slackChannelId: "C0123CRIT",
      slackWarningChannelId: undefined,
      tags: {},
    });
    await flush();
    const roles = recorded.filter((r) => r.type === "aws:iam/role:Role");
    expect(roles).toHaveLength(1);
    const trust = await new Promise<string>((res) =>
      pulumi.output(roles[0].inputs.assumeRolePolicy as string).apply(res),
    );
    expect(trust).toContain("chatbot.amazonaws.com");

    // No managed policy: `CloudWatchReadOnlyAccess` would grant `logs:Get*`,
    // `logs:FilterLogEvents` and `logs:StartLiveTail` on every log group in the
    // account — the PHI-carrying surface.
    expect(
      recorded.filter((r) => r.type === "aws:iam/rolePolicyAttachment:RolePolicyAttachment"),
    ).toHaveLength(0);

    const inline = recorded.filter((r) => r.type === "aws:iam/rolePolicy:RolePolicy");
    expect(inline).toHaveLength(1);
    const doc = await new Promise<string>((res) =>
      pulumi.output(inline[0].inputs.policy as string).apply(res),
    );
    expect(doc).not.toContain("logs:");
    const parsed = JSON.parse(doc) as { Statement: Array<{ Action: string[] }> };
    expect(parsed.Statement).toHaveLength(1);
    expect(parsed.Statement[0].Action.slice().sort()).toEqual([
      "cloudwatch:DescribeAlarms",
      "cloudwatch:GetMetricData",
      "cloudwatch:GetMetricStatistics",
      "cloudwatch:GetMetricWidgetImage",
      "cloudwatch:ListMetrics",
    ]);
  });
});
