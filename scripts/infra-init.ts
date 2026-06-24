import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

import { QUEUE_PROFILES, type ProfileName } from "../infra/shared/queue-profiles";
import { buildEnv } from "../infra/shared/env-manifest";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_PROFILES: ProfileName[] = ["local", "gcp", "aws", "azure", "render", "vercel"];
const VALID_VARIANTS = ["sandbox", "production"] as const;
type Variant = (typeof VALID_VARIANTS)[number];

// ---------------------------------------------------------------------------
// Minimal prompt helper that works with both TTY and piped stdin
// ---------------------------------------------------------------------------

/** Collect all stdin lines upfront when not a TTY; otherwise read interactively. */
function createPrompter(): {
  question: (prompt: string) => Promise<string>;
  close: () => void;
} {
  const isTTY = process.stdin.isTTY;

  if (isTTY) {
    // Interactive mode: use readline/promises
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return {
      question: (prompt: string) =>
        new Promise<string>((resolve) => {
          process.stdout.write(prompt);
          rl.once("line", (line) => resolve(line));
        }),
      close: () => rl.close(),
    };
  }

  // Non-interactive (piped) mode: buffer all lines first, then serve them
  const lines: string[] = [];
  let lineIndex = 0;
  let resolveReady: (() => void) | null = null;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (line) => lines.push(line));
  rl.once("close", () => resolveReady!());

  return {
    question: async (prompt: string): Promise<string> => {
      await ready;
      const line = lines[lineIndex] ?? "";
      if (prompt) process.stdout.write(prompt);
      console.log(line); // echo the piped input
      lineIndex++;
      return line;
    },
    close: () => {}, // already closed by readline 'close' event
  };
}

// ---------------------------------------------------------------------------
// Next-steps helpers
// ---------------------------------------------------------------------------

export function formatNextSteps(
  profile: ProfileName,
  variant: Variant,
  baseDomain: string | undefined,
): string {
  const lines: string[] = [];

  lines.push(`\nNext steps for "${profile}" (${variant}):`);

  switch (profile) {
    case "local":
      lines.push(
        "  1. Start local services:",
        "     docker compose up -d postgres redis",
        "",
        "  2. Run dev server:",
        "     pnpm dev",
      );
      break;

    case "gcp":
      lines.push(
        "  1. Edit infra/gcp/config." + variant + ".yaml (copy from config." + variant + ".example.yaml)",
        `     pnpm infra:configure --env ${variant}`,
        "",
        "  2. One-time setup (state bucket + stacks; runs configure automatically):",
        `     pnpm infra:init --env ${variant}`,
        "",
        "  3. Deploy all six layers in dependency order:",
        `     pnpm infra:deploy --env ${variant}`,
        "",
        "  4. Verify (read-only diff, all layers):",
        `     pnpm infra:preview --env ${variant}`,
        "",
        "  See infra/gcp/README.md for the full step-by-step guide.",
      );
      break;

    case "aws":
      lines.push(
        "  1. Apply Pulumi core stack:",
        `     cd infra/aws/core && pulumi up -s ${variant}`,
        "",
        "  2. Apply apps stack:",
        `     cd infra/aws/apps && pulumi up -s ${variant}`,
        "",
        "  3. Verify smoke:",
        "     pulumi stack output dashboardUrl",
        "",
        "  Note: Phase 6.1 is the canonical implementation — see infra/aws/README.md when ready.",
      );
      break;

    case "azure":
      lines.push(
        "  1. Apply Pulumi core stack:",
        `     cd infra/azure/core && pulumi up -s ${variant}`,
        "",
        "  2. Apply apps stack:",
        `     cd infra/azure/apps && pulumi up -s ${variant}`,
        "",
        "  3. Verify smoke:",
        "     pulumi stack output dashboardUrl",
        "",
        "  Note: Phase 6.2 is the canonical implementation — see infra/azure/README.md when ready.",
      );
      break;

    case "render":
      lines.push(
        "  1. Link your Render project:",
        "     render login",
        "",
        "  2. Push to deploy:",
        "     git push origin main",
        "",
        "  3. Check the Render dashboard:",
        "     https://dashboard.render.com",
        "",
        "  Note: Phase 7 is the canonical implementation — see infra/render/README.md when ready.",
      );
      break;

    case "vercel":
      lines.push(
        "  1. Link your Vercel project:",
        "     vercel link",
        "",
        "  2. Create the project (first time):",
        "     vercel project add",
        "",
        "  3. Deploy:",
        "     vercel --prod",
        "",
        "  Note: Phase 8 is the canonical implementation — see infra/vercel/README.md when ready.",
      );
      break;
  }

  // Env preview
  lines.push("");
  lines.push("Environment wiring preview:");

  let envVars: Record<string, string>;
  try {
    envVars = buildEnv(profile, { baseDomain });
  } catch {
    envVars = {};
  }

  const entries = Object.entries(envVars);
  const SHOW = 5;
  const preview = entries.slice(0, SHOW);
  for (const [key, val] of preview) {
    const display = val === "" ? "<set via secrets>" : val;
    lines.push(`  ${key}=${display}`);
  }
  if (entries.length > SHOW) {
    lines.push(`  ... (${entries.length - SHOW} more)`);
  }

  if (profile !== "local") {
    lines.push("");
    lines.push(`See infra/${profile}/README.md for full details.`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Hostname validation
// ---------------------------------------------------------------------------

function isValidHostname(value: string): boolean {
  return /^[a-zA-Z0-9]([a-zA-Z0-9\-\.]*[a-zA-Z0-9])?$/.test(value) && value.includes(".");
}

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const prompter = createPrompter();

  console.log("\n=== Deploy Profile Setup ===");
  console.log("This wizard writes infra/.generated/profile.json so all infra");
  console.log("tooling knows which cloud target to use.\n");

  // --- Prompt 1: profile ---
  let profile: ProfileName | undefined;
  while (!profile) {
    const raw = await prompter.question(`Profile [${VALID_PROFILES.join("|")}]: `);
    const trimmed = raw.trim().toLowerCase() as ProfileName;
    if ((VALID_PROFILES as string[]).includes(trimmed)) {
      profile = trimmed;
    } else if (trimmed === "") {
      console.log(`  Please enter one of: ${VALID_PROFILES.join(", ")}`);
    } else {
      console.log(
        `  "${trimmed}" is not a valid profile. Choose from: ${VALID_PROFILES.join(", ")}`,
      );
    }
  }

  // --- Prompt 2: variant ---
  let variant: Variant = "sandbox";
  const rawVariant = await prompter.question(
    `Variant [${VALID_VARIANTS.join("|")}] (default: sandbox): `,
  );
  const trimmedVariant = rawVariant.trim().toLowerCase();
  if (trimmedVariant === "" || trimmedVariant === "sandbox") {
    variant = "sandbox";
  } else if (trimmedVariant === "production") {
    variant = "production";
  } else {
    console.log(`  Invalid variant "${trimmedVariant}", defaulting to sandbox.`);
    variant = "sandbox";
  }

  // --- Prompt 3: baseDomain (skip for local) ---
  let baseDomain: string | undefined;
  if (profile !== "local") {
    let domainOk = false;
    while (!domainOk) {
      const raw = await prompter.question("Base domain (e.g. example.com): ");
      const trimmed = raw.trim().toLowerCase();
      if (trimmed === "") {
        console.log("  Base domain is required for non-local profiles.");
      } else if (!isValidHostname(trimmed)) {
        console.log(`  "${trimmed}" doesn't look like a valid hostname (e.g. example.com).`);
      } else {
        baseDomain = trimmed;
        domainOk = true;
      }
    }
  }

  prompter.close();

  // --- Write profile.json ---
  const queue = QUEUE_PROFILES[profile];
  const outDir = path.resolve(process.cwd(), "infra/.generated");
  const outFile = path.join(outDir, "profile.json");

  fs.mkdirSync(outDir, { recursive: true });

  const profileData = {
    profile,
    variant,
    ...(baseDomain !== undefined ? { baseDomain } : {}),
    queue: {
      adapter: queue.adapter,
      consumerMode: queue.consumerMode,
    },
    generatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(outFile, JSON.stringify(profileData, null, 2) + "\n", "utf8");

  console.log(`\n✔ Profile saved to infra/.generated/profile.json`);

  // --- Print next steps + env preview ---
  const nextSteps = formatNextSteps(profile, variant, baseDomain);
  console.log(nextSteps);
}

main().catch((err) => {
  console.error("infra-init failed:", err);
  process.exit(1);
});
