# GCP IaC P7 — Master Script & Pipelines Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single TypeScript orchestrator (`infra/scripts/infra.ts`, run via `tsx`) that deploys/previews/destroys the six GCP Pulumi layers in dependency order against a self-managed GCS state backend behind a preflight gate, plus two GitHub Actions workflows — a manual infra pipeline with a production approval gate and a git-triggered app-release pipeline with a migrate gate and zero-downtime Cloud Run rollout.

**Architecture:** A pure helper module (`infra/scripts/orchestration.ts`, Vitest-unit-tested, no I/O) owns layer ordering, arg parsing, ephemeral-stack naming, StackReference path building, and config parsing. The impure CLI (`infra/scripts/infra.ts`) shells out to `pulumi`/`gcloud`/`curl` via `node:child_process` and calls the already-tested pure `runPreflight` from `infra/shared/preflight.ts`. The six Pulumi projects live under `infra/gcp/{bootstrap,database,storage,messaging,secrets,apps}` (P1–P6); P7 only orchestrates them — it creates no Pulumi resources. CI invokes the same `pnpm infra:*` scripts so local and pipeline behavior are identical.

**Tech Stack:** TypeScript ^5.7, `tsx` ^4, Vitest ^3, Pulumi CLI (GCS self-managed backend), `gcloud` SDK, GitHub Actions (`google-github-actions/auth` WIF, `docker/build-push-action`), Cloud Run + Cloud Run Jobs, Artifact Registry.

**Design spec:** [`docs/superpowers/specs/2026-06-06-gcp-comprehensive-iac-design.md`](../specs/2026-06-06-gcp-comprehensive-iac-design.md) (§6 deploy model, §7 master script + state + preflight, §8 flags, §9 build/test ladder).

---

## Dependencies on prior plans (locked — do not contradict)

From [P1](./2026-06-06-gcp-iac-p1-foundations-bootstrap.md):

- The pure `runPreflight(input: PreflightInput): PreflightResult` lives at `infra/shared/preflight.ts` and is already unit-tested. P7 **reuses** it and must not re-test or re-implement it.
- `bootstrap` exports (consumed here): `artifactRegistryRepo`, `deployServiceAccountEmail`, `workloadIdentityProvider`, `projectId`, `region`.
- The six layer project directories already exist: `infra/gcp/{bootstrap,database,storage,messaging,secrets,apps}`, each a standalone Pulumi project named `starter-gcp-<layer>` with stacks per env (`sandbox`, `staging`, `production`) and `gcp:project` set in `Pulumi.<env>.yaml`.

**Layer dependency order (locked):**

```
bootstrap
 ├─> database ─┐
 ├─> storage ──┤
 ├─> messaging ┤
 └─> secrets ──┤   (secrets also needs database)
               └─> apps   (apps needs all of 1–5)
```

- **Deploy order:** `bootstrap → database → storage → messaging → secrets → apps`.
- **Destroy order (reverse):** `apps → secrets → messaging → storage → database → bootstrap`.
- `database` and `storage` are `protect: true`; destroying them requires manual unprotect first.

**State backend (locked):** self-managed GCS bucket named `<project>-pulumi-state`, created idempotently with `gcloud storage buckets create`, versioning enabled, then `pulumi login gs://<bucket>`. On a self-managed backend, `StackReference` names are `organization/<project>/<stack>` (the literal `organization` is Pulumi's fixed org segment for non-SaaS backends).

## File Structure

- Create: `infra/scripts/orchestration.ts` — pure helpers (layer order, arg parsing, ephemeral naming, stackRef path, config parsing).
- Create: `infra/scripts/orchestration.test.ts` — colocated L1 unit tests (Critical Tests).
- Create: `infra/scripts/infra.ts` — the orchestrator CLI (impure: `pulumi`/`gcloud`/`curl` via `node:child_process`; state pre-step; preflight gate).
- Modify: `package.json` (root) — repoint `infra:deploy`, add `infra:preview`/`infra:destroy`/`infra:test:ephemeral`, move the existing profile wizard to `infra:init:profile`, repoint `infra:init` to the orchestrator.
- Modify: `scripts/vitest.config.ts` — add `infra/scripts/**/*.test.ts` to `include` so `pnpm test:scripts` runs the new tests.
- Create: `.github/workflows/infra-deploy.yml` — manual `workflow_dispatch` infra pipeline (WIF, prod approval, runs `pnpm infra:deploy`).
- Create: `.github/workflows/app-release.yml` — git-triggered build → migrate gate → zero-downtime Cloud Run rollout.
- Modify: `infra/README.md` — replace placeholder Quick-start with real orchestrator commands + pipeline overview.
- Modify (optional cleanup): `.github/workflows/deploy-gcp.yml` — retire its `build-images`/`deploy` jobs (superseded by `app-release.yml`); keep only the PR `preview` job for L3.

## Critical Tests

**Required.** All in the colocated `infra/scripts/orchestration.test.ts`. These cover the pure seams; live `pulumi`/`gcloud` calls in `infra.ts` are not unit-tested (they are exercised by `infra:preview`/L4 in CI). The existing `runPreflight` is **plugged in, not re-tested**.

- `infra/scripts/orchestration.test.ts`:
  - **Deploy order** — `deployOrder()` equals `["bootstrap","database","storage","messaging","secrets","apps"]`; every layer appears after all of its `LAYER_DEPENDENCIES`.
  - **Destroy order** — `destroyOrder()` is exactly `deployOrder()` reversed (`apps` first, `bootstrap` last).
  - **Arg parsing** — `parseArgs` defaults `env` to `sandbox`; parses `--env staging` and `--env=production`; rejects an invalid env value with a clear error; rejects an unknown layer; ignores unknown flags (e.g. `--yes`); throws when no command is given.
  - **Ephemeral stack naming** — `ephemeralStackName()` starts with `ephemeral-` (clearly disposable) and two invocations with different inputs are unique.
  - **StackRef path builder** — `stackRefPath("database","production")` returns `organization/starter-gcp-database/production`.
  - **Config parse** — `parseProjectIdFromConfig` extracts `gcp:project` from a `Pulumi.<env>.yaml` body (quoted and unquoted) and returns `undefined` when absent.

---

## Task 1: Pure orchestration helpers (TDD)

**Files:**

- Create: `infra/scripts/orchestration.test.ts`
- Create: `infra/scripts/orchestration.ts`

- [ ] **Step 1: Write the failing test** (`infra/scripts/orchestration.test.ts`)

```ts
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
    expect(parseArgs(["deploy"])).toEqual({ command: "deploy", layer: undefined, env: "sandbox" });
  });

  it("parses a layer positional and --env flag", () => {
    expect(parseArgs(["deploy", "database", "--env", "staging"])).toEqual({
      command: "deploy",
      layer: "database",
      env: "staging",
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
    });
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --config scripts/vitest.config.ts infra/scripts/orchestration.test.ts`
Expected: FAIL — cannot resolve `./orchestration`.

- [ ] **Step 3: Write the implementation** (`infra/scripts/orchestration.ts`)

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --config scripts/vitest.config.ts infra/scripts/orchestration.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add infra/scripts/orchestration.ts infra/scripts/orchestration.test.ts
git commit -m "feat(infra): pure orchestration helpers for gcp master script"
```

## Task 2: Orchestrator CLI (`infra/scripts/infra.ts`)

This task contains the **GCS state pre-step** and the **preflight gate**. The CLI is impure: it shells out to `pulumi`/`gcloud`/`curl` and calls the pure, already-tested `runPreflight`. The gcloud fact-gathering is isolated in `gatherPreflightFacts`; the decision logic stays in `runPreflight`.

**Files:**

- Create: `infra/scripts/infra.ts`

- [ ] **Step 1: Write the implementation** (`infra/scripts/infra.ts`)

```ts
#!/usr/bin/env tsx
// GCP IaC master orchestrator. Deploys/previews/destroys the six Pulumi layers
// in dependency order against a self-managed GCS state backend, behind a preflight
// gate. All decision logic lives in pure helpers (orchestration.ts) and the pure
// runPreflight (infra/shared/preflight.ts); this file owns the side effects only.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { createInterface } from "node:readline/promises";

import { runPreflight, type PreflightInput } from "../shared/preflight";
import {
  LAYER_DEPENDENCIES,
  PROTECTED_LAYERS,
  REQUIRED_CONFIG_KEYS,
  deployOrder,
  destroyOrder,
  ephemeralStackName,
  layerDir,
  parseArgs,
  parseProjectIdFromConfig,
  stackRefPath,
  stateBucketName,
  type Env,
  type Layer,
} from "./orchestration";

const REGION = process.env.GCP_REGION ?? "us-central1";

// --- thin shell wrapper -------------------------------------------------------

interface ShOptions {
  cwd?: string;
  /** Capture stdout (returned trimmed) instead of inheriting it. */
  capture?: boolean;
}

function sh(cmd: string, args: string[], opts: ShOptions = {}): string {
  const out = execFileSync(cmd, args, {
    cwd: opts.cwd,
    stdio: opts.capture ? ["inherit", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
    env: process.env,
  });
  return (out ?? "").toString().trim();
}

/** Run an effect, returning true on success and false on any thrown error. */
function ok(effect: () => unknown): boolean {
  try {
    return effect() !== false;
  } catch {
    return false;
  }
}

function pulumi(args: string[], layer: Layer): void {
  sh("pulumi", args, { cwd: layerDir(layer) });
}

// --- project id + state backend pre-step -------------------------------------

function getProjectId(env: Env): string {
  const file = path.join(layerDir("bootstrap"), `Pulumi.${env}.yaml`);
  const projectId = parseProjectIdFromConfig(readFileSync(file, "utf8"));
  if (!projectId) {
    throw new Error(`gcp:project is not set in ${file}. Run \`pnpm infra:init --env ${env}\` first.`);
  }
  return projectId;
}

/**
 * Idempotent GCS state-bucket pre-step: create the bucket (ignore "already
 * exists"), enable object versioning, then `pulumi login` against it.
 */
function ensureStateBackend(projectId: string): string {
  const bucket = stateBucketName(projectId);
  console.log(`\n▶ Ensuring Pulumi state bucket gs://${bucket} …`);
  if (
    !ok(() =>
      sh("gcloud", [
        "storage",
        "buckets",
        "create",
        `gs://${bucket}`,
        `--project=${projectId}`,
        `--location=${REGION}`,
        "--uniform-bucket-level-access",
      ]),
    )
  ) {
    console.log("  bucket already exists (ignored)");
  }
  // Enable versioning (idempotent) so state history is recoverable.
  ok(() => sh("gcloud", ["storage", "buckets", "update", `gs://${bucket}`, "--versioning"]));
  sh("pulumi", ["login", `gs://${bucket}`]);
  return bucket;
}

// --- preflight gate -----------------------------------------------------------

/** Impure: gathers facts via gcloud and reads layer config. Decision logic stays
 *  in the pure runPreflight. */
function gatherPreflightFacts(env: Env, projectId: string, bucket: string): PreflightInput {
  const authenticated = ok(() =>
    sh("gcloud", ["auth", "application-default", "print-access-token"], { capture: true }),
  );
  const projectExists = ok(() => sh("gcloud", ["projects", "describe", projectId], { capture: true }));
  const billingLinked = ok(() => {
    const value = sh(
      "gcloud",
      ["beta", "billing", "projects", "describe", projectId, "--format=value(billingEnabled)"],
      { capture: true },
    );
    return value.toLowerCase() === "true";
  });
  const stateBucketReachable = ok(() =>
    sh("gcloud", ["storage", "ls", `gs://${bucket}`], { capture: true }),
  );

  const file = path.join(layerDir("bootstrap"), `Pulumi.${env}.yaml`);
  const config: Record<string, string | undefined> = {
    "gcp:project": parseProjectIdFromConfig(readFileSync(file, "utf8")),
    "gcp:region": REGION,
  };

  return {
    authenticated,
    billingLinked,
    projectExists,
    stateBucketReachable,
    config,
    requiredKeys: [...REQUIRED_CONFIG_KEYS],
  };
}

function preflightOrAbort(env: Env, projectId: string, bucket: string): void {
  console.log("\n▶ Preflight …");
  const result = runPreflight(gatherPreflightFacts(env, projectId, bucket));
  if (!result.ok) {
    console.error("✖ Preflight failed:");
    for (const err of result.errors) console.error(`  - ${err}`);
    process.exit(1);
  }
  console.log("✓ Preflight passed");
}

// --- per-layer pulumi actions -------------------------------------------------

function deployLayer(layer: Layer, stack: string): void {
  console.log(`\n▶ pulumi up — ${layer} (${stack})`);
  pulumi(["up", "--yes", "--stack", stack, "--non-interactive"], layer);
}

function previewLayer(layer: Layer, stack: string): void {
  console.log(`\n▶ pulumi preview — ${layer} (${stack})`);
  pulumi(
    ["preview", "--stack", stack, "--policy-pack", "../../shared/policies", "--non-interactive"],
    layer,
  );
}

function destroyLayer(layer: Layer, stack: string): void {
  console.log(`\n▶ pulumi destroy — ${layer} (${stack})`);
  pulumi(["destroy", "--yes", "--stack", stack, "--non-interactive"], layer);
}

/** Ensure a stack exists and wire gcp config + cross-layer StackReference keys. */
function ensureStackConfig(layer: Layer, stack: string, projectId: string): void {
  if (!ok(() => pulumi(["stack", "select", stack, "--non-interactive"], layer))) {
    pulumi(["stack", "init", stack, "--non-interactive"], layer);
  }
  pulumi(["config", "set", "gcp:project", projectId, "--stack", stack], layer);
  pulumi(["config", "set", "gcp:region", REGION, "--stack", stack], layer);
  for (const dep of LAYER_DEPENDENCIES[layer]) {
    pulumi(["config", "set", `${dep}StackRef`, stackRefPath(dep, stack), "--stack", stack], layer);
  }
}

// --- interactive confirm (skipped in CI via --yes or INFRA_CONFIRM) ----------

async function confirm(question: string, expected: string): Promise<void> {
  if (process.argv.includes("--yes") || process.env.INFRA_CONFIRM === expected) return;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  if (answer.trim() !== expected) {
    console.error("Aborted.");
    process.exit(1);
  }
}

// --- commands -----------------------------------------------------------------

function cmdDeploy(layer: Layer | undefined, env: Env): void {
  const projectId = getProjectId(env);
  const bucket = ensureStateBackend(projectId);
  preflightOrAbort(env, projectId, bucket);
  const layers = layer ? [layer] : deployOrder();
  for (const l of layers) deployLayer(l, env);
  console.log("\n✓ Deploy complete.");
}

function cmdPreview(layer: Layer | undefined, env: Env): void {
  const projectId = getProjectId(env);
  ensureStateBackend(projectId);
  const layers = layer ? [layer] : deployOrder();
  for (const l of layers) previewLayer(l, env);
  console.log("\n✓ Preview complete (no changes applied).");
}

async function cmdDestroy(layer: Layer | undefined, env: Env): Promise<void> {
  const projectId = getProjectId(env);
  ensureStateBackend(projectId);
  const layers = layer ? [layer] : destroyOrder();

  console.warn(`\n⚠ This will DESTROY [${layers.join(", ")}] in env "${env}".`);
  for (const l of layers) {
    if (PROTECTED_LAYERS.includes(l)) {
      console.warn(
        `  • "${l}" is PROTECTED. Unprotect first, e.g.\n` +
          `    cd ${layerDir(l)} && pulumi state unprotect '*' --stack ${env}  (or set protect:false), then re-run.`,
      );
    }
  }
  await confirm(`Type "${env}" to confirm destroy: `, env);

  for (const l of layers) destroyLayer(l, env);
  console.log("\n✓ Destroy complete.");
}

/**
 * L4 ephemeral test (on-demand only): init + up every layer on a uniquely-named
 * disposable stack, smoke-test health, then ALWAYS destroy — even on failure.
 */
async function cmdEphemeral(): Promise<void> {
  const env: Env = "sandbox";
  const projectId = getProjectId(env);
  ensureStateBackend(projectId);
  const stack = ephemeralStackName();

  console.log(`\n▶ Ephemeral L4 run on stack "${stack}" (always torn down) …`);
  let failed = false;
  try {
    for (const l of deployOrder()) {
      ensureStackConfig(l, stack, projectId);
      deployLayer(l, stack);
    }
    smokeTest(stack);
  } catch (err) {
    failed = true;
    console.error("✖ Ephemeral apply/smoke failed:", err);
  } finally {
    console.log("\n▶ Tearing down ephemeral stacks (always) …");
    for (const l of destroyOrder()) {
      ok(() => destroyLayer(l, stack));
      ok(() => pulumi(["stack", "rm", stack, "--yes", "--non-interactive"], l));
    }
  }
  process.exit(failed ? 1 : 0);
}

function smokeTest(stack: string): void {
  const url = sh("pulumi", ["stack", "output", "dashboardUrl", "--stack", stack], {
    cwd: layerDir("apps"),
    capture: true,
  });
  if (!url) throw new Error("apps layer did not output dashboardUrl");
  console.log(`  smoke: GET ${url}/api/health`);
  sh("curl", ["-fsS", `${url}/api/health`]);
}

function cmdInit(env: Env): void {
  const projectId = getProjectId(env);
  ensureStateBackend(projectId);
  for (const l of deployOrder()) {
    console.log(`\n▶ Init ${l} stack "${env}"`);
    ensureStackConfig(l, env, projectId);
  }
  console.log(`\n✓ Init complete for env "${env}".`);
}

// --- entrypoint ---------------------------------------------------------------

async function main(): Promise<void> {
  const { command, layer, env } = parseArgs(process.argv.slice(2));
  switch (command) {
    case "deploy":
      cmdDeploy(layer, env);
      break;
    case "preview":
      cmdPreview(layer, env);
      break;
    case "destroy":
      await cmdDestroy(layer, env);
      break;
    case "ephemeral":
      await cmdEphemeral();
      break;
    case "init":
      cmdInit(env);
      break;
    default:
      console.error(`Unknown command "${command}". Use: deploy|preview|destroy|ephemeral|init`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 2: Type-check the new scripts**

Run: `pnpm exec tsc --noEmit --strict --module esnext --moduleResolution bundler --skipLibCheck infra/scripts/infra.ts infra/scripts/orchestration.ts`
Expected: PASS (no type errors). If `node:readline/promises` types are missing, ensure `@types/node` ^24 resolves at repo root (it is a root devDependency).

- [ ] **Step 3: Commit**

```bash
git add infra/scripts/infra.ts
git commit -m "feat(infra): gcp master orchestrator cli (state pre-step + preflight gate)"
```

## Task 3: Wire pnpm scripts + Vitest include

**Files:**

- Modify: `package.json` (root)
- Modify: `scripts/vitest.config.ts`

- [ ] **Step 1: Repoint the `infra:*` scripts** in root `package.json`

Replace the existing `infra:init` / `infra:deploy` lines (and the orphaned reference to a profile-specific deploy) with the orchestrator wiring. The existing multi-cloud profile wizard (`scripts/infra-init.ts`) moves to `infra:init:profile` so it is not lost.

```json
    "validate:env": "tsx scripts/validate-env.mts",
    "infra:init:profile": "tsx scripts/infra-init.ts",
    "infra:init": "tsx infra/scripts/infra.ts init",
    "infra:deploy": "tsx infra/scripts/infra.ts deploy",
    "infra:preview": "tsx infra/scripts/infra.ts preview",
    "infra:destroy": "tsx infra/scripts/infra.ts destroy",
    "infra:test:ephemeral": "tsx infra/scripts/infra.ts ephemeral",
    "test:scripts": "vitest run --config scripts/vitest.config.ts"
```

Usage (pnpm forwards trailing args, so a leading `--` is not required for positionals but is required to forward flags):

```bash
pnpm infra:deploy --env sandbox            # all layers, in order
pnpm infra:deploy database --env staging   # one layer
pnpm infra:preview --env sandbox           # read-only L3 diff, all layers
pnpm infra:destroy --env sandbox           # reverse order, with confirmation
pnpm infra:test:ephemeral                  # L4 apply → smoke → destroy (sandbox)
pnpm infra:init --env staging              # bucket + login + stack init + config
```

- [ ] **Step 2: Add `infra/scripts` to the Vitest include** (`scripts/vitest.config.ts`)

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "scripts/**/*.test.ts",
      "infra/shared/**/*.test.ts",
      "infra/scripts/**/*.test.ts",
    ],
  },
});
```

- [ ] **Step 3: Run the script test suite**

Run: `pnpm test:scripts`
Expected: PASS — includes `infra/scripts/orchestration.test.ts` alongside the existing `scripts/validate-env.test.ts` and `infra/shared/*` tests.

- [ ] **Step 4: Commit**

```bash
git add package.json scripts/vitest.config.ts
git commit -m "chore(infra): wire infra orchestrator pnpm scripts + vitest include"
```

## Task 4: Infra pipeline workflow (`.github/workflows/infra-deploy.yml`)

Manual `workflow_dispatch`; uses Workload Identity Federation (no JSON keys); production routes through the protected `production-gcp` GitHub Environment (add required reviewers there). Runs the same `pnpm infra:deploy` the orchestrator exposes locally.

**Files:**

- Create: `.github/workflows/infra-deploy.yml`

- [ ] **Step 1: Write the workflow** (`.github/workflows/infra-deploy.yml`)

```yaml
name: Infra Deploy (GCP)

on:
  workflow_dispatch:
    inputs:
      env:
        description: "Target environment"
        type: choice
        required: true
        default: sandbox
        options:
          - sandbox
          - staging
          - production
      layer:
        description: "Single layer to deploy (blank = all in dependency order)"
        type: string
        required: false
        default: ""

permissions:
  contents: read
  id-token: write # required for WIF/OIDC

env:
  PULUMI_SKIP_UPDATE_CHECK: "true"

jobs:
  deploy:
    name: "infra:deploy (${{ github.event.inputs.env }})"
    runs-on: ubuntu-latest
    timeout-minutes: 60
    # production routes through the protected environment with required reviewers;
    # sandbox/staging run unattended.
    environment: ${{ github.event.inputs.env == 'production' && 'production-gcp' || '' }}
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 11.1.3

      - uses: actions/setup-node@v4
        with:
          node-version: 24.16.0
          cache: pnpm

      - name: Install root deps (tsx)
        run: pnpm install --frozen-lockfile

      - id: gcp-auth
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}
          service_account: ${{ secrets.GCP_DEPLOY_SERVICE_ACCOUNT }}

      - uses: google-github-actions/setup-gcloud@v2

      - name: Install Pulumi CLI
        run: |
          curl -fsSL https://get.pulumi.com | sh
          echo "$HOME/.pulumi/bin" >> "$GITHUB_PATH"

      - name: Install Pulumi layer deps
        run: |
          for d in bootstrap database storage messaging secrets apps; do
            (cd "infra/gcp/$d" && pnpm install)
          done

      - name: Run infra:deploy
        env:
          GCP_REGION: ${{ vars.GCP_REGION }}
          PULUMI_CONFIG_PASSPHRASE: ${{ secrets.PULUMI_CONFIG_PASSPHRASE }}
        run: pnpm infra:deploy ${{ github.event.inputs.layer }} --env ${{ github.event.inputs.env }}
```

Notes:

- `PULUMI_CONFIG_PASSPHRASE` is required because a self-managed GCS backend encrypts stack secrets with a passphrase (no Pulumi SaaS). Store it as a repo/Environment secret.
- The orchestrator runs its own preflight (auth, billing, project, state bucket, required config) before any `pulumi up`, so a misconfigured environment fails fast with actionable errors instead of a half-applied stack.

- [ ] **Step 2: Validate workflow syntax**

Run: `gh workflow view "Infra Deploy (GCP)" 2>/dev/null || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/infra-deploy.yml'))" && echo "YAML OK"`
Expected: `YAML OK` (or `gh` lists the workflow once pushed).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/infra-deploy.yml
git commit -m "ci(infra): manual gcp infra-deploy pipeline with prod approval gate"
```

## Task 5: App release pipeline (`.github/workflows/app-release.yml`)

Git-triggered: build+push all 5 images (matrix) → run the `starter-migrate` Cloud Run Job as a **gate** → deploy each Cloud Run revision `--no-traffic` → smoke-test the candidate revision → shift traffic 100%. Any failure aborts before traffic shifts (old revision keeps serving).

**Files:**

- Create: `.github/workflows/app-release.yml`

- [ ] **Step 1: Write the workflow** (`.github/workflows/app-release.yml`)

```yaml
name: App Release (GCP)

on:
  push:
    branches: [main]
    tags: ["v*"]

permissions:
  contents: read
  id-token: write # required for WIF/OIDC

jobs:
  # ---------------------------------------------------------------------------
  # 1. Build & push all five images to Artifact Registry, pinned to this SHA.
  # ---------------------------------------------------------------------------
  build-images:
    name: "Build & push (${{ matrix.app.name }})"
    runs-on: ubuntu-latest
    timeout-minutes: 60
    strategy:
      matrix:
        app:
          - { name: dashboard, dockerfile: infra/shared/docker/Dockerfile.dashboard }
          - { name: www, dockerfile: infra/shared/docker/Dockerfile.www }
          - { name: public-api, dockerfile: infra/shared/docker/Dockerfile.public-api }
          - { name: public-mcp, dockerfile: infra/shared/docker/Dockerfile.public-mcp }
          - { name: workers, dockerfile: apps/workers/Dockerfile }
    steps:
      - uses: actions/checkout@v4

      - id: gcp-auth
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}
          service_account: ${{ secrets.GCP_DEPLOY_SERVICE_ACCOUNT }}

      - uses: google-github-actions/setup-gcloud@v2

      - name: Configure Docker auth for Artifact Registry
        run: gcloud auth configure-docker ${{ vars.GCP_REGION }}-docker.pkg.dev --quiet

      - uses: docker/setup-buildx-action@v3

      - name: Build & push ${{ matrix.app.name }}
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ${{ matrix.app.dockerfile }}
          push: true
          tags: ${{ vars.GCP_ARTIFACT_REGISTRY }}/${{ matrix.app.name }}:${{ github.sha }}
          cache-from: type=gha,scope=${{ matrix.app.name }}
          cache-to: type=gha,scope=${{ matrix.app.name }},mode=max

  # ---------------------------------------------------------------------------
  # 2. Migration GATE: point starter-migrate at this SHA and run it to completion.
  #    Failure here aborts the release — no new revision receives traffic.
  # ---------------------------------------------------------------------------
  migrate-gate:
    name: Migrate gate (starter-migrate)
    needs: [build-images]
    runs-on: ubuntu-latest
    timeout-minutes: 20
    environment: production-gcp
    steps:
      - id: gcp-auth
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}
          service_account: ${{ secrets.GCP_DEPLOY_SERVICE_ACCOUNT }}

      - uses: google-github-actions/setup-gcloud@v2

      # The migrate job is DEFINED by IaC (apps layer) with command
      # `prisma migrate deploy`; here we only pin its image + execute it.
      - name: Pin migrate job image to this SHA
        run: |
          gcloud run jobs update starter-migrate \
            --region "${{ vars.GCP_REGION }}" \
            --image "${{ vars.GCP_ARTIFACT_REGISTRY }}/dashboard:${{ github.sha }}" \
            --quiet

      - name: Execute migrations (gate)
        run: gcloud run jobs execute starter-migrate --region "${{ vars.GCP_REGION }}" --wait

  # ---------------------------------------------------------------------------
  # 3. Zero-downtime rollout per service: deploy --no-traffic, smoke the
  #    candidate revision, then shift 100% traffic. Abort before shifting on
  #    any failure (expand/contract migrations keep the old revision compatible).
  # ---------------------------------------------------------------------------
  deploy:
    name: "Deploy revision (${{ matrix.svc.name }})"
    needs: [migrate-gate]
    runs-on: ubuntu-latest
    timeout-minutes: 30
    environment: production-gcp
    strategy:
      max-parallel: 5
      matrix:
        svc:
          - { name: starter-dashboard, image: dashboard, public: true, health: /api/health }
          - { name: starter-www, image: www, public: true, health: /api/health }
          - { name: starter-public-api, image: public-api, public: true, health: /health }
          - { name: starter-public-mcp, image: public-mcp, public: true, health: /health }
          - { name: starter-workers, image: workers, public: false, health: "" }
    steps:
      - id: gcp-auth
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}
          service_account: ${{ secrets.GCP_DEPLOY_SERVICE_ACCOUNT }}

      - uses: google-github-actions/setup-gcloud@v2

      - name: Deploy new revision (no traffic, tagged "candidate")
        run: |
          gcloud run deploy "${{ matrix.svc.name }}" \
            --image "${{ vars.GCP_ARTIFACT_REGISTRY }}/${{ matrix.svc.image }}:${{ github.sha }}" \
            --region "${{ vars.GCP_REGION }}" \
            --no-traffic \
            --tag candidate \
            --quiet

      - name: Smoke-test candidate revision
        if: ${{ matrix.svc.public == true }}
        run: |
          URL=$(gcloud run services describe "${{ matrix.svc.name }}" \
            --region "${{ vars.GCP_REGION }}" --format=json \
            | jq -r '.status.traffic[] | select(.tag=="candidate") | .url')
          if [[ -z "$URL" || "$URL" == "null" ]]; then
            echo "ERROR: no candidate revision URL found" >&2
            exit 1
          fi
          ok=0
          for i in 1 2 3 4 5 6; do
            if curl -fsS "$URL${{ matrix.svc.health }}" >/dev/null 2>&1; then
              echo "  candidate OK: $URL${{ matrix.svc.health }}"
              ok=1
              break
            fi
            echo "  attempt $i failed; sleeping 5s"
            sleep 5
          done
          if [[ $ok -ne 1 ]]; then
            echo "ERROR: candidate health failed — NOT shifting traffic" >&2
            exit 1
          fi

      - name: Shift 100% traffic to the new revision
        run: |
          gcloud run services update-traffic "${{ matrix.svc.name }}" \
            --region "${{ vars.GCP_REGION }}" \
            --to-latest \
            --quiet
```

Notes:

- **Rollback:** the previous revision is retained, so an instant rollback is a traffic shift back to it:
  `gcloud run services update-traffic <svc> --region <region> --to-revisions <prev-revision>=100`.
- The migrate job is **defined** by IaC (reproducible) but **triggered** here, so migrations version with app code (spec §6).

- [ ] **Step 2: Validate workflow syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/app-release.yml'))" && echo "YAML OK"`
Expected: `YAML OK`.

- [ ] **Step 3: (Optional cleanup) retire overlapping jobs in `deploy-gcp.yml`**

`app-release.yml` supersedes the `build-images` and `deploy` jobs in the legacy `.github/workflows/deploy-gcp.yml`, and `infra-deploy.yml` supersedes its manual dispatch. Keep only `deploy-gcp.yml`'s PR `preview` job (L3 preview on PRs) to avoid double builds/deploys on push to `main`. If you make this edit, remove the `push:`/`workflow_dispatch:` triggers and the `build-images`/`deploy` jobs from `deploy-gcp.yml`, leaving the `pull_request` trigger and `preview` job.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/app-release.yml
git commit -m "ci(app): git-triggered release with migrate gate + zero-downtime rollout"
```

## Task 6: Update `infra/README.md` quick-start

**Files:**

- Modify: `infra/README.md`

- [ ] **Step 1: Replace the "Quick start" section** (`infra/README.md`)

Swap the placeholder block for the real orchestrator commands and the two-pipeline model.

````markdown
## Quick start (GCP master orchestrator)

All commands accept `--env sandbox|staging|production` (default `sandbox`) and run a
preflight (auth, billing, project, state bucket, required config) before any apply.
State lives in a self-managed GCS bucket (`<project>-pulumi-state`); the orchestrator
creates it idempotently and runs `pulumi login gs://…` for you.

```bash
# One-time per env: ensure state bucket + pulumi login + stack init + cross-layer config
pnpm infra:init --env sandbox

# Deploy all six layers in dependency order (bootstrap → db/storage/messaging → secrets → apps)
pnpm infra:deploy --env sandbox

# Deploy a single layer
pnpm infra:deploy database --env staging

# Read-only diff (L3) for every layer
pnpm infra:preview --env sandbox

# Tear down in reverse order (apps → … → bootstrap), with confirmation.
# database/storage are protected — unprotect them first (the command prints how).
pnpm infra:destroy --env sandbox

# L4 ephemeral proof: apply → smoke-test → destroy a throwaway stack (on-demand only)
pnpm infra:test:ephemeral
```

> The multi-cloud profile wizard moved to `pnpm infra:init:profile`.

### Pipelines

- **Infra pipeline** — `.github/workflows/infra-deploy.yml`, manual `workflow_dispatch`
  with `{env, layer}` inputs. Uses Workload Identity Federation; `production` routes
  through the `production-gcp` GitHub Environment (required reviewers). Runs `pnpm infra:deploy`.
- **App release pipeline** — `.github/workflows/app-release.yml`, on push to `main`/tags.
  Builds+pushes all 5 images → runs the `starter-migrate` Cloud Run Job as a gate →
  deploys each Cloud Run revision `--no-traffic` → smoke-tests the candidate → shifts
  traffic to 100%. Rollback: `gcloud run services update-traffic <svc> --to-revisions <prev>=100`.

### Zero-downtime rules (enforced / process)

1. New revision deployed `--no-traffic`, gated on a health smoke before any traffic.
2. **Expand/contract migrations** — old and new revisions share the DB during rollout, so
   every migration must be backward-compatible (add nullable/new → backfill → later drop).
3. **Graceful shutdown / worker drain** on SIGTERM; workers finish/ack in-flight jobs before exit.
4. **Backward-compatible Pub/Sub message contracts** (at-least-once; concurrent old/new workers).
5. Prior revisions are retained for instant rollback.
````

- [ ] **Step 2: Verify the doc renders and links resolve**

Run: `pnpm format:check infra/README.md 2>/dev/null || prettier --check infra/README.md`
Expected: PASS (or run `prettier --write infra/README.md` then re-check).

- [ ] **Step 3: Commit**

```bash
git add infra/README.md
git commit -m "docs(infra): real master-orchestrator quick-start + pipeline overview"
```

## Self-Review checklist (run after completing tasks)

- `orchestration.ts` exports exactly the helpers the Critical Tests import; deploy/destroy orders and stackRef paths match the locked facts.
- `infra.ts` calls the pure `runPreflight` from `infra/shared/preflight.ts` (imported, not re-implemented) and aborts on `!ok`.
- The state pre-step is idempotent (ignores "already exists") and enables versioning before `pulumi login`.
- Destroy honors reverse order and warns about protected `database`/`storage`.
- `infra:test:ephemeral` always tears down in a `finally`, even when apply/smoke fails.
- Both workflows authenticate via WIF (no JSON keys); `infra-deploy.yml` gates production via `production-gcp`; `app-release.yml` aborts before shifting traffic on any failure.
- No placeholders remain in code or YAML.

## Verification

- `pnpm test:scripts` — runs `infra/scripts/orchestration.test.ts` (+ existing script/shared tests); all green.
- `pnpm exec tsc --noEmit --strict --module esnext --moduleResolution bundler --skipLibCheck infra/scripts/infra.ts infra/scripts/orchestration.ts` — type-checks the orchestrator.
- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/infra-deploy.yml')); yaml.safe_load(open('.github/workflows/app-release.yml'))" && echo "workflows OK"` — YAML validity.
- `prettier --check infra/README.md` — doc formatting.
- Once P1–P6 layers exist and an env is initialized: `pnpm infra:preview --env sandbox` — end-to-end smoke (preflight passes, read-only `pulumi preview` runs per layer with the CrossGuard policy pack, no resources changed).
