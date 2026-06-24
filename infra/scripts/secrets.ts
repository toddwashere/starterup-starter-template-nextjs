#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";

import { SECRET_CATALOG } from "../shared/secret-catalog";
import {
  buildSecretStatusRows,
  formatSecretStatusTable,
  placeholderSecretsNeedingValues,
  secretIdFromArg,
} from "../shared/secret-status";
import {
  ENVS,
  isEnv,
  layerDir,
  parseProjectIdFromConfig,
  type Env,
} from "./orchestration";

export interface ParsedSecretsArgs {
  command: "status" | "set";
  env: Env;
  secretArg?: string;
  fromEnv?: string;
  strict: boolean;
}

export function parseSecretsArgs(argv: readonly string[]): ParsedSecretsArgs {
  let env: string = "sandbox";
  let secretArg: string | undefined;
  let fromEnv: string | undefined;
  let strict = false;
  const positionals: string[] = [];

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
    if (token === "--strict") {
      strict = true;
      continue;
    }
    if (token === "--from-env") {
      fromEnv = argv[++i];
      continue;
    }
    if (token.startsWith("-")) {
      continue;
    }
    positionals.push(token);
  }

  const [command, ...rest] = positionals;
  if (command !== "status" && command !== "set") {
    throw new Error(
      'Missing command. Use: status|set [--env <env>] (set also needs <secret-id>)',
    );
  }
  if (!isEnv(env)) {
    throw new Error(`Invalid --env "${env}". Expected one of: ${ENVS.join(", ")}`);
  }

  if (command === "set") {
    secretArg = rest[0];
    if (!secretArg) {
      throw new Error("set requires a secret id (e.g. stripe-secret-key or STRIPE_SECRET_KEY).");
    }
    if (rest.length > 1) {
      throw new Error(`Unexpected arguments: ${rest.slice(1).join(" ")}`);
    }
  } else if (rest.length > 0) {
    throw new Error(`status does not take positional arguments: ${rest.join(" ")}`);
  }

  return { command, env, secretArg, fromEnv, strict };
}

function readProjectId(env: Env): string {
  const file = path.join(layerDir("bootstrap"), `Pulumi.${env}.yaml`);
  const projectId = parseProjectIdFromConfig(readFileSync(file, "utf8"));
  if (!projectId) {
    throw new Error(
      `gcp:project is not set in ${file}. Run \`pnpm infra:configure --env ${env}\` first.`,
    );
  }
  return projectId;
}

function gcloud(args: string[], opts: { capture?: boolean } = {}): string {
  const out = execFileSync("gcloud", args, {
    stdio: opts.capture ? ["inherit", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  });
  return (out ?? "").toString();
}

function fetchSecretPayload(projectId: string, secretId: string): string | null {
  try {
    gcloud(["secrets", "describe", secretId, `--project=${projectId}`], { capture: true });
  } catch {
    return null;
  }
  try {
    return gcloud(
      [
        "secrets",
        "versions",
        "access",
        "latest",
        `--secret=${secretId}`,
        `--project=${projectId}`,
      ],
      { capture: true },
    );
  } catch {
    return null;
  }
}

async function readSecretValue(fromEnv: string | undefined): Promise<string> {
  if (fromEnv) {
    const value = process.env[fromEnv];
    if (!value?.trim()) {
      throw new Error(`Environment variable ${fromEnv} is empty or unset.`);
    }
    return value;
  }

  if (process.stdin.isTTY) {
    process.stderr.write("Paste secret value, then press Ctrl-D:\n");
  }

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const lines: string[] = [];
  for await (const line of rl) {
    lines.push(line);
  }
  const value = lines.join("\n");
  if (!value.trim()) {
    throw new Error("No secret value provided on stdin.");
  }
  return value;
}

function cmdStatus(env: Env, strict: boolean): number {
  const projectId = readProjectId(env);
  console.log(`Secret status for project "${projectId}" (env ${env}):\n`);

  const payloads: Record<string, string | null> = {};
  for (const secret of SECRET_CATALOG) {
    payloads[secret.id] = fetchSecretPayload(projectId, secret.id);
  }

  const rows = buildSecretStatusRows(SECRET_CATALOG, payloads);
  console.log(formatSecretStatusTable(rows));

  const needing = placeholderSecretsNeedingValues(rows);
  if (needing.length > 0) {
    console.log("\nPlaceholder secrets still needed:");
    for (const row of needing) {
      console.log(
        `  • ${row.id} (${row.envVar}) — readers: ${row.readers.join(", ")}`,
      );
      console.log(
        `    pnpm infra:secrets:set --env ${env} ${row.id}`,
      );
    }
  } else {
    console.log("\n✓ All placeholder secrets have values.");
  }

  if (strict && needing.length > 0) {
    return 1;
  }
  return 0;
}

async function cmdSet(env: Env, secretArg: string, fromEnv: string | undefined): Promise<void> {
  const secret = secretIdFromArg(SECRET_CATALOG, secretArg);
  if (!secret) {
    throw new Error(
      `Unknown secret "${secretArg}". Expected a catalog id or env var name.`,
    );
  }
  if (secret.generation !== "placeholder") {
    throw new Error(
      `${secret.id} is ${secret.generation} by Pulumi — do not set it manually.`,
    );
  }

  const projectId = readProjectId(env);
  const value = await readSecretValue(fromEnv);

  execFileSync(
    "gcloud",
    [
      "secrets",
      "versions",
      "add",
      secret.id,
      "--data-file=-",
      `--project=${projectId}`,
    ],
    { input: value, stdio: ["pipe", "inherit", "inherit"] },
  );

  console.log(`✓ Added new version for ${secret.id} (${secret.envVar}).`);
}

async function main(): Promise<void> {
  const parsed = parseSecretsArgs(process.argv.slice(2));
  if (parsed.command === "status") {
    process.exit(cmdStatus(parsed.env, parsed.strict));
  }
  await cmdSet(parsed.env, parsed.secretArg!, parsed.fromEnv);
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
