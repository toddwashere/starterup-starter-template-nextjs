// AWS Lambda handler that runs `prisma migrate deploy` from inside the VPC.
//
// GitHub-hosted runners cannot reach the RDS instance (private subnets, no
// public route), and PgBouncer runs in transaction mode which breaks Prisma's
// session-scoped advisory lock. So migrations run here instead, and GitHub
// never holds a database credential.
//
// Plain .mjs on purpose: the Lambda RIC probes `<path>`, `.js`, `.mjs`, `.cjs`
// and never `.ts`, so a TypeScript handler can never be resolved.
import { spawn } from "node:child_process";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

/** Pull migration names out of `prisma migrate deploy` stdout. */
export function parseAppliedMigrations(stdout) {
  const applied = [];
  for (const line of String(stdout).split("\n")) {
    const match = line.match(/Applying migration `([^`]+)`/);
    if (match) applied.push(match[1]);
  }
  return applied;
}

// `spawnImpl` is overridable so tests can inject a fake child process and
// exercise the stream-level error path without a real EPIPE.
export function run(command, args, options, spawnImpl = spawn) {
  return new Promise((resolve) => {
    const child = spawnImpl(command, args, options);
    let stdout = "";
    let stderr = "";
    // A stream-level `error` (e.g. EPIPE) has no default listener, so an
    // unhandled 'error' event throws synchronously inside Node's
    // EventEmitter. The handler must never throw, so both stdout and
    // stderr get their own error handler that resolves the same way the
    // child-process `error` handler does.
    const onStreamError = (err) => {
      resolve({ exitCode: 1, stdout, stderr: `${stderr}${err.message}` });
    };
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.stdout.on("error", onStreamError);
    child.stderr.on("error", onStreamError);
    child.on("error", (err) => {
      resolve({ exitCode: 1, stdout, stderr: `${stderr}${err.message}` });
    });
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

async function defaultGetDirectUrl(secretArn) {
  const client = new SecretsManagerClient({});
  const secret = await client.send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );
  return secret.SecretString;
}

// The second parameter is a test-only seam: `spawnImpl`/`getDirectUrl` let
// tests inject a fake child process and a fake secret lookup so the real
// spawn/AWS command path can be exercised end-to-end without a real prisma
// binary or a real Secrets Manager call. Lambda invokes `handler(event,
// context)`; `context` doesn't carry these keys, so destructuring defaults
// still apply per-key in production and this is a no-op there.
export async function handler(
  _event,
  { spawnImpl = spawn, getDirectUrl = defaultGetDirectUrl } = {},
) {
  const secretArn = process.env.DIRECT_URL_SECRET_ARN;
  if (!secretArn) {
    // Never throw: the workflow reads `ok` from the payload, and a thrown
    // handler yields a less useful error surface than a structured failure.
    return {
      ok: false,
      exitCode: 1,
      applied: [],
      stdout: "",
      stderr: "",
      error: "DIRECT_URL_SECRET_ARN is not set on the function",
    };
  }

  let directUrl;
  try {
    directUrl = await getDirectUrl(secretArn);
  } catch (err) {
    return {
      ok: false,
      exitCode: 1,
      applied: [],
      stdout: "",
      stderr: "",
      error: `Failed to read ${secretArn}: ${err.message}`,
    };
  }

  if (!directUrl) {
    return {
      ok: false,
      exitCode: 1,
      applied: [],
      stdout: "",
      stderr: "",
      error: `Secret ${secretArn} has an empty SecretString`,
    };
  }

  const taskRoot = process.env.LAMBDA_TASK_ROOT ?? process.cwd();
  const cwd = `${taskRoot}/packages/database`;

  // Prisma resolves DIRECT_URL ?? DATABASE_URL for migrations; prisma.config.ts
  // also reads DATABASE_URL while loading, so set both to the direct connection.
  //
  // The prisma bin lives under packages/database/node_modules/.bin, not the
  // task root's node_modules/.bin: the root package.json declares no
  // dependencies and nothing hoists a root-level bin, so pnpm only links
  // `prisma` inside the database package. Do NOT switch this to a
  // cwd-relative path (e.g. "./node_modules/.bin/prisma") either — Node
  // resolves a relative command against process.cwd(), not the child's cwd
  // option, so that would fail the same way from a different cwd.
  const { exitCode, stdout, stderr } = await run(
    `${taskRoot}/packages/database/node_modules/.bin/prisma`,
    ["migrate", "deploy"],
    {
      cwd,
      env: {
        ...process.env,
        DIRECT_URL: directUrl,
        DATABASE_URL: directUrl,
      },
    },
    spawnImpl,
  );

  return {
    ok: exitCode === 0,
    exitCode,
    applied: parseAppliedMigrations(stdout),
    stdout,
    stderr,
  };
}
