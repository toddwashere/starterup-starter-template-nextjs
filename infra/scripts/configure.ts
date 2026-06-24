#!/usr/bin/env tsx
import { writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { placeholderSecrets } from "../shared/secret-catalog";
import {
  GCP_ENV_NAMES,
  envConfigPath,
  fanOutLayerConfig,
  renderPulumiStackYaml,
  validateEnvConfig,
  type GcpEnvConfig,
  type GcpEnvName,
  type LayerName,
} from "../shared/gcp-env-config";

const LAYERS: LayerName[] = [
  "bootstrap",
  "database",
  "storage",
  "messaging",
  "secrets",
  "apps",
];

function parseEnvArg(argv: string[]): GcpEnvName {
  let env: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--env" || argv[i] === "-e") env = argv[++i];
    if (argv[i]?.startsWith("--env=")) env = argv[i]!.slice("--env=".length);
  }
  if (!env) return "sandbox";
  if (!(GCP_ENV_NAMES as readonly string[]).includes(env)) {
    throw new Error(`Invalid --env "${env}". Expected: ${GCP_ENV_NAMES.join("|")}`);
  }
  return env as GcpEnvName;
}

async function loadEnvConfig(env: GcpEnvName): Promise<GcpEnvConfig> {
  const path = join(process.cwd(), envConfigPath(env));
  try {
    const mod = (await import(pathToFileURL(path).href)) as { config?: GcpEnvConfig };
    if (!mod.config) {
      throw new Error(`Expected export "config" from ${envConfigPath(env)}`);
    }
    return mod.config;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to load ${envConfigPath(env)}: ${message}`);
  }
}

function atomicWrite(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

function layerPulumiPath(layer: LayerName, env: GcpEnvName): string {
  return join("infra", "gcp", layer, `Pulumi.${env}.yaml`);
}

function printPlaceholderChecklist(): void {
  console.log("\nPlaceholder secrets (populate after deploy via gcloud — never in config files):");
  for (const s of placeholderSecrets()) {
    console.log(`  • ${s.id} → env ${s.envVar} (readers: ${s.readers.join(", ")})`);
  }
}

async function main(): Promise<void> {
  const env = parseEnvArg(process.argv.slice(2));
  const config = await loadEnvConfig(env);
  const validation = validateEnvConfig(config, env);

  for (const w of validation.warnings) console.warn(`⚠ ${w}`);
  if (!validation.ok) {
    console.error("✖ Configure failed:");
    for (const e of validation.critical) console.error(`  - ${e}`);
    process.exit(1);
  }

  for (const layer of LAYERS) {
    const entries = fanOutLayerConfig(layer, env, config);
    const yaml = renderPulumiStackYaml(entries);
    const path = layerPulumiPath(layer, env);
    atomicWrite(path, yaml);
    console.log(`✓ Wrote ${path}`);
  }

  printPlaceholderChecklist();
  console.log(`\nNext: pnpm infra:init --env ${env} && pnpm infra:deploy --env ${env}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
