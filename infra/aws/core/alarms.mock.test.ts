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

// MetricAlarm takes `name`; CompositeAlarm (no `name` input in the AWS
// provider — only `alarmName`) needs the fallback to be found the same way.
function alarmNamed(name: string) {
  const found = recorded.find((r) => (r.inputs.name ?? r.inputs.alarmName) === name);
  if (!found) {
    throw new Error(
      `no alarm named ${name}; got ${recorded.map((r) => r.inputs.name ?? r.inputs.alarmName).join(", ")}`,
    );
  }
  return found;
}

// Pulumi's mock `newResource` callback fires on a later tick than the
// synchronous resource constructor, so every other *.mock.test.ts in this
// package waits a beat before asserting on `recorded`. Match that convention.
function flush() {
  return new Promise<void>((resolve) => setTimeout(resolve, 100));
}

describe("core alarm severity tiers", () => {
  it("notifies the critical topic on both breach and recovery", async () => {
    const alarms = await load();
    alarms.dlqDepthAlarm(ctx, { slug: "jobs", dlqName: "q-dlq", severity: "critical" });
    await flush();
    const alarm = alarmNamed("starter-test-jobs-dlq-not-empty");
    expect(alarm.inputs.alarmActions).toEqual([CRITICAL]);
    expect(alarm.inputs.okActions).toEqual([CRITICAL]);
  });

  it("notifies the warning topic on breach and stays silent on recovery", async () => {
    const alarms = await load();
    alarms.dlqDepthAlarm(ctx, { slug: "jobs", dlqName: "q-dlq", severity: "warning" });
    await flush();
    const alarm = alarmNamed("starter-test-jobs-dlq-not-empty");
    expect(alarm.inputs.alarmActions).toEqual([WARNING]);
    expect(alarm.inputs.okActions).toBeUndefined();
  });

  it("gives composite children no actions of their own", async () => {
    const alarms = await load();
    alarms.rdsSaturationAlarms(ctx, {
      instanceId: "db-1",
      instanceClass: "db.t4g.small",
      allocatedStorageGb: 50,
      severity: "critical",
    });
    await flush();
    for (const child of ["db-cpu-high", "db-connections-high", "db-storage-low"]) {
      const alarm = alarmNamed(`starter-test-${child}`);
      expect(alarm.inputs.alarmActions).toBeUndefined();
      expect(alarm.inputs.okActions).toBeUndefined();
    }
  });

  it("builds a composite that ORs exactly the children it created", async () => {
    const alarms = await load();
    alarms.rdsSaturationAlarms(ctx, {
      instanceId: "db-1",
      instanceClass: "db.t4g.small",
      allocatedStorageGb: 50,
      severity: "critical",
    });
    await flush();
    const composite = alarmNamed("starter-test-database-saturation");
    expect(composite.type).toBe("aws:cloudwatch/compositeAlarm:CompositeAlarm");
    const rule = await new Promise<string>((res) =>
      pulumi.output(composite.inputs.alarmRule as string).apply(res),
    );
    expect(rule).toBe(
      'ALARM("starter-test-db-cpu-high") OR ALARM("starter-test-db-connections-high") OR ALARM("starter-test-db-storage-low")',
    );
    expect(composite.inputs.alarmActions).toEqual([CRITICAL]);
    expect(composite.inputs.okActions).toEqual([CRITICAL]);
  });

  it("omits the connections child from the rule for an unlisted instance class", async () => {
    const alarms = await load();
    const result = alarms.rdsSaturationAlarms(ctx, {
      instanceId: "db-1",
      instanceClass: "db.r7g.xlarge",
      allocatedStorageGb: 50,
      severity: "warning",
    });
    await flush();
    expect(result.children).toHaveLength(2);
    const rule = await new Promise<string>((res) =>
      pulumi.output(alarmNamed("starter-test-database-saturation").inputs.alarmRule as string).apply(res),
    );
    expect(rule).toBe(
      'ALARM("starter-test-db-cpu-high") OR ALARM("starter-test-db-storage-low")',
    );
  });

  it("depends on every child its rule names", async () => {
    const alarms = await load();
    alarms.rdsSaturationAlarms(ctx, {
      instanceId: "db-1",
      instanceClass: "db.t4g.small",
      allocatedStorageGb: 50,
      severity: "critical",
    });
    await flush();
    // Without the dependsOn edge Pulumi sees the rule as opaque strings and is
    // free to delete a child in the same update that rewrites the rule, or to
    // delete one before the composite on destroy.
    expect(dependencyNames("starter-test-database-saturation")).toEqual([
      "starter-test-db-connections-high",
      "starter-test-db-cpu-high",
      "starter-test-db-storage-low",
    ]);
  });

  it("depends on only the children created for an unlisted instance class", async () => {
    const alarms = await load();
    alarms.rdsSaturationAlarms(ctx, {
      instanceId: "db-1",
      instanceClass: "db.r7g.xlarge",
      allocatedStorageGb: 50,
      severity: "warning",
    });
    await flush();
    expect(dependencyNames("starter-test-database-saturation")).toEqual([
      "starter-test-db-cpu-high",
      "starter-test-db-storage-low",
    ]);
  });

  it("requires two of three windows before calling storage low", async () => {
    const alarms = await load();
    alarms.rdsSaturationAlarms(ctx, {
      instanceId: "db-1",
      instanceClass: "db.t4g.small",
      allocatedStorageGb: 50,
      severity: "critical",
    });
    await flush();
    const storage = alarmNamed("starter-test-db-storage-low");
    expect(storage.inputs.evaluationPeriods).toBe(3);
    expect(storage.inputs.datapointsToAlarm).toBe(2);
  });
});
