import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  envConfigPath,
  type GcpEnvConfig,
  type GcpEnvName,
} from "../shared/gcp-env-config";

/** Dynamic-import the TypeScript env profile for an environment. */
export async function loadEnvConfig(env: GcpEnvName): Promise<GcpEnvConfig> {
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
