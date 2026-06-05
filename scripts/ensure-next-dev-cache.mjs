import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const nextApps = ["www", "dashboard"];

function hasCorruptInstrumentationCache(app) {
  const chunksDir = path.join(
    repoRoot,
    "apps",
    app,
    ".next",
    "dev",
    "server",
    "chunks",
  );

  if (!fs.existsSync(chunksDir)) {
    return false;
  }

  for (const file of fs.readdirSync(chunksDir)) {
    if (!file.includes("instrumentation")) {
      continue;
    }

    const content = fs.readFileSync(path.join(chunksDir, file), "utf8");
    if (
      content.includes("MODULE_UNPARSABLE") ||
      content.includes("file not found")
    ) {
      return true;
    }
  }

  return false;
}

for (const app of nextApps) {
  if (!hasCorruptInstrumentationCache(app)) {
    continue;
  }

  fs.rmSync(path.join(repoRoot, "apps", app, ".next"), {
    recursive: true,
    force: true,
  });
  console.log(
    `[dev] Cleared stale Turbopack cache for @apps/${app} (corrupt instrumentation chunk)`,
  );
}
