#!/usr/bin/env tsx
import { writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

import { placeholderSecrets } from "../shared/secret-catalog";
import {
  fanOutLayerConfig,
  renderPulumiStackYaml,
  validateEnvConfig,
  type LayerName,
} from "../shared/gcp-env-config";
import { loadEnvConfig } from "./load-env-config";
import { parseConfigureArgs } from "./parse-configure-args";

const LAYERS: LayerName[] = [
  "bootstrap",
  "database",
  "storage",
  "messaging",
  "secrets",
  "apps",
];

function atomicWrite(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

function layerPulumiPath(layer: LayerName, env: ReturnType<typeof parseConfigureArgs>["env"]): string {
  return join("infra", "gcp", layer, `Pulumi.${env}.yaml`);
}

function printPlaceholderChecklist(): void {
  console.log("\nPlaceholder secrets (populate after deploy via gcloud — never in config files):");
  for (const s of placeholderSecrets()) {
    console.log(`  • ${s.id} → env ${s.envVar} (readers: ${s.readers.join(", ")})`);
  }
}

async function main(): Promise<void> {
  const { env, printResolved } = parseConfigureArgs(process.argv.slice(2));
  const config = await loadEnvConfig(env);
  const validation = validateEnvConfig(config, env);

  if (printResolved) {
    console.log(JSON.stringify(config, null, 2));
    for (const w of validation.warnings) console.warn(`⚠ ${w}`);
    if (!validation.ok) {
      console.error("✖ Config validation failed:");
      for (const e of validation.critical) console.error(`  - ${e}`);
      process.exit(1);
    }
    return;
  }

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
