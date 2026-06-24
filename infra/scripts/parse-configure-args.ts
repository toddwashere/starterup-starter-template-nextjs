import { GCP_ENV_NAMES, type GcpEnvName } from "../shared/gcp-env-config";

export interface ParsedConfigureArgs {
  env: GcpEnvName;
  printResolved: boolean;
}

export function parseConfigureArgs(argv: readonly string[]): ParsedConfigureArgs {
  let env: string | undefined;
  let printResolved = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--env" || token === "-e") env = argv[++i];
    if (token?.startsWith("--env=")) env = token.slice("--env=".length);
    if (token === "--print-resolved") printResolved = true;
  }

  const resolvedEnv = env ?? "sandbox";
  if (!(GCP_ENV_NAMES as readonly string[]).includes(resolvedEnv)) {
    throw new Error(`Invalid --env "${resolvedEnv}". Expected: ${GCP_ENV_NAMES.join("|")}`);
  }

  return { env: resolvedEnv as GcpEnvName, printResolved };
}
