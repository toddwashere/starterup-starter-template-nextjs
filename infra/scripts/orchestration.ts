// Pure orchestration helpers for the GCP IaC master script.
// NO I/O here — every function is deterministic and unit-tested. All
// pulumi/gcloud side effects live in infra/scripts/infra.ts.

export const LAYERS = [
  "bootstrap",
  "database",
  "storage",
  "messaging",
  "secrets",
  "apps",
] as const;
export type Layer = (typeof LAYERS)[number];

export const ENVS = ["sandbox", "staging", "production"] as const;
export type Env = (typeof ENVS)[number];

/** Upstream layers each layer reads via StackReference. */
export const LAYER_DEPENDENCIES: Record<Layer, readonly Layer[]> = {
  bootstrap: [],
  database: ["bootstrap"],
  storage: ["bootstrap"],
  messaging: ["bootstrap"],
  secrets: ["bootstrap", "database"],
  apps: ["bootstrap", "database", "storage", "messaging", "secrets"],
};

/** Layers whose resources are `protect: true` and need manual unprotect to destroy. */
export const PROTECTED_LAYERS: readonly Layer[] = ["database", "storage"];

/** Pulumi config keys every layer must have set before an apply. */
export const REQUIRED_CONFIG_KEYS = ["gcp:project", "gcp:region"] as const;

/** Dependency-sorted deploy order. `database`/`storage`/`messaging` may run in
 *  parallel after `bootstrap`; we serialize them here for deterministic, safe runs. */
export function deployOrder(): Layer[] {
  return [...LAYERS];
}

/** Reverse of deploy order — tear down dependents before their dependencies. */
export function destroyOrder(): Layer[] {
  return [...LAYERS].reverse();
}

export function isLayer(value: string): value is Layer {
  return (LAYERS as readonly string[]).includes(value);
}

export function isEnv(value: string): value is Env {
  return (ENVS as readonly string[]).includes(value);
}

/** Pulumi project directory for a layer, relative to the repo root. */
export function layerDir(layer: Layer): string {
  return `infra/gcp/${layer}`;
}

/** Self-managed GCS Pulumi state bucket name, derived from the project id. */
export function stateBucketName(projectId: string): string {
  return `${projectId}-pulumi-state`;
}

/**
 * StackReference path for a dependency layer on a self-managed backend.
 * Self-managed (GCS) backends use the literal `organization` org segment, so the
 * fully-qualified name is `organization/<project>/<stack>`.
 */
export function stackRefPath(dep: Layer, stack: string, org = "organization"): string {
  return `${org}/starter-gcp-${dep}/${stack}`;
}

/**
 * Unique, clearly-disposable ephemeral stack name for L4 tests.
 * Params are injectable so the name is deterministic under test.
 */
export function ephemeralStackName(
  now: Date = new Date(),
  rand: string = Math.random().toString(36).slice(2, 8),
): string {
  const ts = now.toISOString().replace(/[-:T]/g, "").slice(0, 14); // YYYYMMDDHHMMSS
  return `ephemeral-${ts}-${rand}`;
}

/** Extract `gcp:project` from a Pulumi.<env>.yaml body (quoted or unquoted). */
export function parseProjectIdFromConfig(yamlText: string): string | undefined {
  const match = yamlText.match(/gcp:project:\s*["']?([^"'\n#]+)["']?/);
  return match ? match[1].trim() : undefined;
}

export interface ParsedArgs {
  command: string;
  layer?: Layer;
  env: Env;
}

/**
 * Parse the orchestrator argv (already sliced past node + script path).
 * Shape: `<command> [layer] [--env <env>|--env=<env>] [other flags ignored]`.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  let env = "sandbox";

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--env" || token === "-e") {
      env = argv[++i] ?? "";
      continue;
    }
    if (token.startsWith("--env=")) {
      env = token.slice("--env=".length);
      continue;
    }
    if (token.startsWith("-")) {
      continue; // ignore unknown flags (e.g. --yes, --non-interactive)
    }
    positionals.push(token);
  }

  const [command, layerArg] = positionals;
  if (!command) {
    throw new Error("Missing command. Use: deploy|preview|destroy|ephemeral|init [layer] [--env <env>]");
  }
  if (!isEnv(env)) {
    throw new Error(`Invalid --env "${env}". Expected one of: ${ENVS.join(", ")}`);
  }

  let layer: Layer | undefined;
  if (layerArg !== undefined) {
    if (!isLayer(layerArg)) {
      throw new Error(`Invalid layer "${layerArg}". Expected one of: ${LAYERS.join(", ")}`);
    }
    layer = layerArg;
  }

  return { command, layer, env };
}
