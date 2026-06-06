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
