#!/usr/bin/env tsx
// Thin AWS Pulumi wrapper. Unlike the GCP orchestrator, the AWS profile uses the
// dedicated-account S3/KMS backend and derives its per-env identifiers (account
// ids, Vercel slug/project, PULUMI_ORG) from the environment — so all this needs
// to do is load infra/.env.local (done by the `pnpm infra:aws` dotenv wrapper)
// and run `pulumi` inside the requested layer directory with those vars present.
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

/**
 * Force `pulumi up` to refresh first, matching .github/workflows/infra-aws.yml.
 *
 * Two systems write App Runner's `sourceConfiguration`: the Release workflow
 * owns `imageIdentifier`, this stack owns everything else. `ignoreChanges` on
 * the image stops Pulumi DIFFING it, but an update still sends the whole
 * `sourceConfiguration` built from STATE -- so a stack whose state predates the
 * last release silently rolls every service back to an older image while
 * reporting a tidy "N updated".
 *
 * Escape hatch: pass `--skip-refresh` (Pulumi's own flag) when you deliberately
 * want state-as-written, and it is left untouched.
 */
export function withRefresh(pulumiArgs: readonly string[]): string[] {
  const [command, ...rest] = pulumiArgs;
  if (command !== "up") return [...pulumiArgs];
  if (pulumiArgs.some((a) => a === "--refresh" || a === "--skip-refresh")) {
    return [...pulumiArgs];
  }
  return [command, "--refresh", ...rest];
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

  if (process.env.PULUMI_ORG?.trim() !== "organization") {
    console.warn(
      "⚠ The AWS S3 backend requires PULUMI_ORG=organization so the apps layer " +
        "can resolve the core StackReference. Set it in infra/.env.local.",
    );
  }

  const args = withRefresh(pulumiArgs);
  console.log(`▶ pulumi ${args.join(" ")}  (${path.relative(process.cwd(), cwd)})`);
  execFileSync("pulumi", args, { cwd, stdio: "inherit", env: process.env });
}

// Only run when invoked as a CLI. Without this guard, importing `withRefresh`
// (from its unit test) would execute main() and exit the process.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
