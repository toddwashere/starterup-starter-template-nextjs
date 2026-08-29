import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_NEXT_DEV_CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const NEXT_APPS = ["www", "dashboard"] as const;

export function getDirectorySizeBytes(dir: string): number {
  if (!fs.existsSync(dir)) return 0;

  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      total += getDirectorySizeBytes(full);
      continue;
    }
    if (entry.isFile()) {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

function hasCorruptInstrumentationCache(nextDir: string): boolean {
  const chunksDir = path.join(nextDir, "dev", "server", "chunks");
  if (!fs.existsSync(chunksDir)) return false;

  for (const file of fs.readdirSync(chunksDir)) {
    if (!file.includes("instrumentation")) continue;
    const content = fs.readFileSync(path.join(chunksDir, file), "utf8");
    if (content.includes("MODULE_UNPARSABLE") || content.includes("file not found")) {
      return true;
    }
  }
  return false;
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GiB`;
}

export function ensureNextDevCache(options: {
  repoRoot: string;
  apps?: readonly string[];
  maxBytes?: number;
  log?: (message: string) => void;
}): { pruned: string[] } {
  const apps = options.apps ?? NEXT_APPS;
  const maxBytes = options.maxBytes ?? DEFAULT_NEXT_DEV_CACHE_MAX_BYTES;
  const log = options.log ?? console.log;
  const pruned: string[] = [];

  for (const app of apps) {
    const nextDir = path.join(options.repoRoot, "apps", app, ".next");
    if (!fs.existsSync(nextDir)) continue;

    const corrupt = hasCorruptInstrumentationCache(nextDir);
    const size = getDirectorySizeBytes(nextDir);
    if (!corrupt && size <= maxBytes) continue;

    fs.rmSync(nextDir, { recursive: true, force: true });
    pruned.push(app);
    if (corrupt) {
      log(`[dev] Cleared stale Turbopack cache for @apps/${app} (corrupt instrumentation chunk)`);
      continue;
    }
    log(
      `[dev] Cleared .next for @apps/${app} (${formatBytes(size)} exceeds ${formatBytes(maxBytes)} cap)`,
    );
  }

  return { pruned };
}

const invokedDirectly =
  Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  ensureNextDevCache({
    repoRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  });
}
