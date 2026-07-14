#!/usr/bin/env tsx
// Thin AWS Pulumi wrapper. Unlike the GCP orchestrator, the AWS profile uses the
// Pulumi Cloud backend and derives its per-env identifiers (account ids, Vercel
// slug/project, PULUMI_ORG) from the environment — so all this needs to do is
// load infra/.env.local (done by the `pnpm infra:aws` dotenv wrapper) and run
// `pulumi` inside the requested layer directory with those vars present.
//
// Usage:
//   pnpm infra:aws <layer> <pulumi args...>
//
// Examples:
//   pnpm infra:aws core preview --stack sandbox
//   pnpm infra:aws apps up --stack sandbox --yes
//   pnpm infra:aws bootstrap preview --stack sandbox

import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const LAYERS = ["bootstrap", "core", "apps"] as const;
type Layer = (typeof LAYERS)[number];

function isLayer(value: string | undefined): value is Layer {
  return value !== undefined && (LAYERS as readonly string[]).includes(value);
}

function main(): void {
  const [layer, ...pulumiArgs] = process.argv.slice(2);

  if (!isLayer(layer)) {
    console.error(
      `Usage: pnpm infra:aws <layer> <pulumi args...>\n` +
        `  layer: ${LAYERS.join(" | ")}\n\n` +
        `Examples:\n` +
        `  pnpm infra:aws core preview --stack sandbox\n` +
        `  pnpm infra:aws apps up --stack sandbox --yes`,
    );
    process.exit(1);
  }
  if (pulumiArgs.length === 0) {
    console.error(`No pulumi command given. Try: pnpm infra:aws ${layer} preview --stack sandbox`);
    process.exit(1);
  }

  // infra/aws/scripts/aws.ts -> infra/aws/<layer>
  const awsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const cwd = path.join(awsRoot, layer);

  if (!process.env.PULUMI_ORG?.trim()) {
    console.warn(
      "⚠ PULUMI_ORG is unset — the apps layer needs it to resolve the core StackReference. " +
        "Set it in infra/.env.local.",
    );
  }

  console.log(`▶ pulumi ${pulumiArgs.join(" ")}  (${path.relative(process.cwd(), cwd)})`);
  execFileSync("pulumi", pulumiArgs, { cwd, stdio: "inherit", env: process.env });
}

main();
