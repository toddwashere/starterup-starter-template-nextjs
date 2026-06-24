#!/usr/bin/env tsx
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

import { placeholderSecrets } from "../shared/secret-catalog";
import {
  GCP_ENV_NAMES,
  envConfigPath,
  envExamplePath,
  fanOutLayerConfig,
  mergeEnvConfig,
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

function loadYamlFile(path: string): Partial<GcpEnvConfig> {
  return parseYaml(readFileSync(path, "utf8")) as Partial<GcpEnvConfig>;
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

function main(): void {
  const env = parseEnvArg(process.argv.slice(2));
  const configFile = envConfigPath(env);
  const exampleFile = envExamplePath(env);

  const defaults = loadYamlFile(exampleFile) as GcpEnvConfig;
  let user: Partial<GcpEnvConfig> = {};
  try {
    user = loadYamlFile(configFile);
  } catch {
    throw new Error(`Missing ${configFile}. Copy ${exampleFile} and set gcp.project.`);
  }

  const merged = mergeEnvConfig(user, defaults);
  const validation = validateEnvConfig(merged, env);

  for (const w of validation.warnings) console.warn(`⚠ ${w}`);
  if (!validation.ok) {
    console.error("✖ Configure failed:");
    for (const e of validation.critical) console.error(`  - ${e}`);
    process.exit(1);
  }

  for (const layer of LAYERS) {
    const entries = fanOutLayerConfig(layer, env, merged);
    const yaml = renderPulumiStackYaml(entries);
    const path = layerPulumiPath(layer, env);
    atomicWrite(path, yaml);
    console.log(`✓ Wrote ${path}`);
  }

  printPlaceholderChecklist();
  console.log(`\nNext: pnpm infra:init --env ${env} && pnpm infra:deploy --env ${env}`);
}

main();
