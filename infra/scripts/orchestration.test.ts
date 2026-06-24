import { describe, it, expect } from "vitest";
import {
  LAYERS,
  LAYER_DEPENDENCIES,
  PROTECTED_LAYERS,
  deployOrder,
  destroyOrder,
  parseArgs,
  stackRefPath,
  stateBucketName,
  ephemeralStackName,
  parseProjectIdFromConfig,
  layerDir,
} from "./orchestration";

describe("layer ordering", () => {
  it("deploy order is bootstrap → … → apps", () => {
    expect(deployOrder()).toEqual([
      "bootstrap",
      "database",
      "storage",
      "messaging",
      "secrets",
      "apps",
    ]);
  });

  it("every layer is ordered after all its dependencies", () => {
    const order = deployOrder();
    for (const layer of LAYERS) {
      const idx = order.indexOf(layer);
      for (const dep of LAYER_DEPENDENCIES[layer]) {
        expect(order.indexOf(dep)).toBeLessThan(idx);
      }
    }
  });

  it("destroy order is the exact reverse of deploy order", () => {
    expect(destroyOrder()).toEqual([...deployOrder()].reverse());
    expect(destroyOrder()[0]).toBe("apps");
    expect(destroyOrder().at(-1)).toBe("bootstrap");
  });

  it("marks database and storage as protected", () => {
    expect(PROTECTED_LAYERS).toEqual(["database", "storage"]);
  });
});

describe("parseArgs", () => {
  it("defaults env to sandbox", () => {
    expect(parseArgs(["deploy"])).toEqual({
      command: "deploy",
      layer: undefined,
      env: "sandbox",
      skipSmoke: false,
    });
  });

  it("parses a layer positional and --env flag", () => {
    expect(parseArgs(["deploy", "database", "--env", "staging"])).toEqual({
      command: "deploy",
      layer: "database",
      env: "staging",
      skipSmoke: false,
    });
  });

  it("parses --env=production form", () => {
    expect(parseArgs(["preview", "--env=production"]).env).toBe("production");
  });

  it("ignores unknown flags such as --yes", () => {
    expect(parseArgs(["destroy", "--yes", "--env", "sandbox"])).toEqual({
      command: "destroy",
      layer: undefined,
      env: "sandbox",
      skipSmoke: false,
    });
  });

  it("parses --skip-smoke", () => {
    expect(parseArgs(["deploy", "--env", "sandbox", "--skip-smoke"]).skipSmoke).toBe(true);
  });

  it("rejects an invalid env", () => {
    expect(() => parseArgs(["deploy", "--env", "prod"])).toThrow(/invalid --env/i);
  });

  it("rejects an unknown layer", () => {
    expect(() => parseArgs(["deploy", "frontend"])).toThrow(/invalid layer/i);
  });

  it("throws when no command is given", () => {
    expect(() => parseArgs([])).toThrow(/missing command/i);
  });
});

describe("stackRefPath", () => {
  it("builds organization/starter-gcp-<dep>/<env>", () => {
    expect(stackRefPath("database", "production")).toBe(
      "organization/starter-gcp-database/production",
    );
    expect(stackRefPath("bootstrap", "sandbox")).toBe(
      "organization/starter-gcp-bootstrap/sandbox",
    );
  });
});

describe("stateBucketName", () => {
  it("derives <project>-pulumi-state", () => {
    expect(stateBucketName("acme-staging")).toBe("acme-staging-pulumi-state");
  });
});

describe("ephemeralStackName", () => {
  it("is clearly disposable and unique", () => {
    const a = ephemeralStackName(new Date("2026-06-06T15:00:00Z"), "aaaaaa");
    const b = ephemeralStackName(new Date("2026-06-06T15:00:00Z"), "bbbbbb");
    expect(a).toMatch(/^ephemeral-/);
    expect(b).toMatch(/^ephemeral-/);
    expect(a).not.toBe(b);
  });
});

describe("parseProjectIdFromConfig", () => {
  it("extracts a quoted gcp:project", () => {
    expect(parseProjectIdFromConfig('config:\n  gcp:project: "acme-prod"\n')).toBe("acme-prod");
  });

  it("extracts an unquoted gcp:project", () => {
    expect(parseProjectIdFromConfig("config:\n  gcp:project: acme-dev\n")).toBe("acme-dev");
  });

  it("returns undefined when missing", () => {
    expect(parseProjectIdFromConfig("config:\n  gcp:region: us-central1\n")).toBeUndefined();
  });
});

describe("layerDir", () => {
  it("maps a layer to its Pulumi project directory", () => {
    expect(layerDir("apps")).toBe("infra/gcp/apps");
  });
});
