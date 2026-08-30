import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

function walk(dir: string, predicate: (path: string) => boolean): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git" || entry === ".turbo") {
      continue;
    }
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...walk(path, predicate));
    } else if (predicate(path)) {
      files.push(path);
    }
  }

  return files;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const prismaFiles = walk(join(ROOT, "packages", "database", "prisma"), (path) =>
  path.endsWith(".prisma"),
);

const numericFieldPattern = /^\s+(\w+)\s+(Int|BigInt|Float|Decimal)\b/;
const errors: string[] = [];

for (const file of prismaFiles) {
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, "utf8").split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const modelMatch = line.match(/^model\s+(\w+)\s+\{/);
    if (modelMatch && lines[index - 1]?.trim().startsWith("///") !== true) {
      errors.push(`${rel}:${index + 1} model ${modelMatch[1]} needs a /// table description`);
    }

    if (/\b(Float|Decimal)\b/.test(line)) {
      errors.push(`${rel}:${index + 1} database values must avoid Float/Decimal`);
    }

    const amountMatch = line.match(numericFieldPattern);
    if (
      amountMatch &&
      amountMatch[1].match(/(?:cost|price|paid)/i) &&
      !amountMatch[1].endsWith("InCents")
    ) {
      errors.push(`${rel}:${index + 1} ${amountMatch[1]} should end with InCents`);
    }

    if (
      amountMatch &&
      rel.endsWith("credits.prisma") &&
      amountMatch[1].match(/(?:amount|balance|overdraft|charged|credits)/i) &&
      !amountMatch[1].includes("Credits") &&
      !amountMatch[1].startsWith("credits") &&
      !amountMatch[1].endsWith("InCents")
    ) {
      errors.push(
        `${rel}:${index + 1} ${amountMatch[1]} should clearly identify credit units or cents`,
      );
    }
  }
}

for (const packageDir of ["packages/credits", "apps/dashboard"]) {
  const configPath = join(ROOT, packageDir, `${packageDir.split("/").at(-1)}.config.ts`);
  try {
    statSync(configPath);
  } catch {
    errors.push(`${relative(ROOT, configPath)} root config file is missing`);
  }
}

if (errors.length > 0) {
  fail(`Credit convention check failed:\n${errors.map((e) => `- ${e}`).join("\n")}`);
}

console.log("Credit convention check passed.");
