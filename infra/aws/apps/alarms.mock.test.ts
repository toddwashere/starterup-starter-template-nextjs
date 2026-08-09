import { describe, it, expect, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";

interface RecordedResource {
  type: string;
  name: string;
  inputs: Record<string, unknown>;
}

const recorded: RecordedResource[] = [];

/** Logical resource name → the dependency URNs registered alongside it. */
const dependencies = new Map<string, string[]>();

const CRITICAL = "arn:aws:sns:us-east-2:123456789012:starter-test-infra-alerts";
const WARNING = `${CRITICAL}-warning`;

async function load() {
  vi.resetModules();
  recorded.length = 0;
  dependencies.clear();
  pulumi.runtime.setMocks(
    {
      newResource: (args) => {
        recorded.push({ type: args.type, name: args.name, inputs: args.inputs });
        return {
          id: `${args.name}-id`,
          state: { ...args.inputs, name: (args.inputs.name as string) ?? args.name },
        };
      },
      call: (args) => args.inputs,
    },
    "test-project",
    "test",
  );
  // `MockResourceArgs` deliberately omits the dependency list, so `dependsOn`
  // is invisible to the `newResource` mock above. Wrap the mock monitor's
  // RegisterResource to read it off the request instead — the composite's edge
  // to its children is exactly what this file needs to assert.
  const monitor = pulumi.runtime.getMonitor() as unknown as {
    registerResource: (req: unknown, cb: unknown) => unknown;
  };
  const inner = monitor.registerResource.bind(monitor);
  monitor.registerResource = (req: unknown, cb: unknown) => {
    const r = req as { getName(): string; getDependenciesList(): string[] };
    dependencies.set(r.getName(), r.getDependenciesList());
    return inner(req, cb);
  };
  return await import("./alarms.js");
}

/** The logical names the given resource declared a dependency on. */
function dependencyNames(resourceName: string): string[] {
  const urns = dependencies.get(resourceName);
  if (!urns) throw new Error(`no RegisterResource recorded for ${resourceName}`);
  return urns.map((urn) => urn.split("::").pop()!).sort();
}

const ctx = {
  namePrefix: "starter-test",
  topicArns: { critical: CRITICAL, warning: WARNING },
  tags: { Project: "starter" },
};

function alarmNamed(name: string) {
  const found = recorded.find(
    (r) => r.inputs.name === name || r.inputs.alarmName === name,
  );
  if (!found) throw new Error(`no alarm named ${name}`);
  return found;
}

// Pulumi's mock `newResource` callback fires on a later tick than the
// synchronous resource constructor, so every other *.mock.test.ts in this
// package waits a beat before asserting on `recorded`. Match that convention.
function flush() {
  return new Promise<void>((resolve) => setTimeout(resolve, 100));
}

/** The silent per-service detectors the composite is built from. */
function children(
  alarms: typeof import("./alarms.js"),
  slugs: string[],
): { slug: string; alarm: ReturnType<typeof alarms.appRunnerServerErrorAlarm> }[] {
  return slugs.map((slug) => ({
    slug,
    alarm: alarms.appRunnerServerErrorAlarm(ctx, {
      slug,
      serviceName: `svc-${slug}`,
      severity: "silent",
    }),
  }));
}

describe("apps alarm severity tiers", () => {
  it("keeps the workers Lambda alarm critical with recovery in production", async () => {
    const alarms = await load();
    alarms.lambdaErrorAlarm(ctx, {
      slug: "workers",
      functionName: "fn",
      description: "Workers Lambda invocation or init errors",
      severity: "critical",
    });
    await flush();
    const alarm = alarmNamed("starter-test-workers-errors");
    expect(alarm.inputs.alarmActions).toEqual([CRITICAL]);
    expect(alarm.inputs.okActions).toEqual([CRITICAL]);
  });

  it("evaluates Lambda errors over five minutes, not one", async () => {
    const alarms = await load();
    alarms.lambdaErrorAlarm(ctx, {
      slug: "workers",
      functionName: "fn",
      description: "d",
      severity: "warning",
    });
    await flush();
    const alarm = alarmNamed("starter-test-workers-errors");
    expect(alarm.inputs.period).toBe(300);
    // Threshold stays zero: a Lambda that errors is always worth knowing about.
    expect(alarm.inputs.threshold).toBe(0);
    expect(alarm.inputs.okActions).toBeUndefined();
  });

  it("makes per-app 5xx alarms silent detectors", async () => {
    const alarms = await load();
    alarms.appRunnerServerErrorAlarm(ctx, {
      slug: "public-api",
      serviceName: "svc",
      severity: "silent",
    });
    await flush();
    const alarm = alarmNamed("starter-test-public-api-5xx");
    expect(alarm.inputs.alarmActions).toBeUndefined();
    expect(alarm.inputs.okActions).toBeUndefined();
    // Detection speed is unchanged — the composite handles the fan-out.
    expect(alarm.inputs.threshold).toBe(5);
    expect(alarm.inputs.evaluationPeriods).toBe(1);
  });

  it("ORs every deployable app into one 5xx composite", async () => {
    const alarms = await load();
    alarms.appRunnerServerErrorComposite(ctx, {
      children: children(alarms, [
        "dashboard",
        "www",
        "public-api",
        "public-mcp",
      ]),
      severity: "critical",
    });
    await flush();
    const composite = alarmNamed("starter-test-apps-5xx");
    expect(composite.type).toBe("aws:cloudwatch/compositeAlarm:CompositeAlarm");
    const rule = await new Promise<string>((res) =>
      pulumi.output(composite.inputs.alarmRule as string).apply(res),
    );
    expect(rule).toBe(
      'ALARM("starter-test-dashboard-5xx") OR ALARM("starter-test-www-5xx") OR ALARM("starter-test-public-api-5xx") OR ALARM("starter-test-public-mcp-5xx")',
    );
    expect(composite.inputs.alarmActions).toEqual([CRITICAL]);
  });

  it("depends on every 5xx alarm its rule names", async () => {
    const alarms = await load();
    alarms.appRunnerServerErrorComposite(ctx, {
      children: children(alarms, ["dashboard", "public-api"]),
      severity: "critical",
    });
    await flush();
    // Without the dependsOn edge Pulumi sees the rule as opaque strings and is
    // free to delete a child in the same update that rewrites the rule (an app
    // flipped to `deploy: false`), or before the composite on destroy.
    expect(dependencyNames("starter-test-apps-5xx")).toEqual([
      "starter-test-dashboard-5xx",
      "starter-test-public-api-5xx",
    ]);
  });

  it("creates no composite when no app reaches App Runner", async () => {
    const alarms = await load();
    // An empty rule string violates the API's minimum length of 1, so the
    // composite must be skipped rather than submitted empty.
    const composite = alarms.appRunnerServerErrorComposite(ctx, {
      children: [],
      severity: "critical",
    });
    await flush();
    expect(composite).toBeUndefined();
    expect(
      recorded.filter((r) => r.type === "aws:cloudwatch/compositeAlarm:CompositeAlarm"),
    ).toHaveLength(0);
  });

  it("derives composite child names from the same helper the alarms use", async () => {
    const alarms = await load();
    expect(alarms.appRunnerServerErrorAlarmName("starter-test", "public-api")).toBe(
      "starter-test-public-api-5xx",
    );
  });
});
