import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { handler, parseAppliedMigrations, run } from "./migrate-handler.mjs";

describe("parseAppliedMigrations", () => {
  it("extracts applied migration names", () => {
    const stdout = [
      "3 migrations found in prisma/migrations",
      "Applying migration `20260721001516_workbench`",
      "Applying migration `20260721010000_my_plan_adherence`",
      "All migrations have been successfully applied.",
    ].join("\n");
    expect(parseAppliedMigrations(stdout)).toEqual([
      "20260721001516_workbench",
      "20260721010000_my_plan_adherence",
    ]);
  });

  it("returns an empty list when nothing is pending", () => {
    const stdout = [
      "38 migrations found in prisma/migrations",
      "No pending migrations to apply.",
    ].join("\n");
    expect(parseAppliedMigrations(stdout)).toEqual([]);
  });

  it("ignores unrelated output", () => {
    expect(parseAppliedMigrations("Datasource \"db\": PostgreSQL")).toEqual([]);
  });
});

describe("run", () => {
  it("resolves with a failure shape instead of throwing when a stdout/stderr stream emits 'error'", async () => {
    // Regression coverage for the stream-level 'error' event (e.g. EPIPE):
    // an EventEmitter throws synchronously on an unhandled 'error' event, so
    // if the stdout/stderr error listeners were ever removed, this test
    // would fail with an uncaught exception rather than a false assertion.
    class FakeStream extends EventEmitter {}
    class FakeChild extends EventEmitter {
      stdout = new FakeStream();
      stderr = new FakeStream();
    }
    const fakeChild = new FakeChild();
    const spawnImpl = () => fakeChild;

    const resultPromise = run("irrelevant", [], {}, spawnImpl);
    fakeChild.stdout.emit("error", new Error("EPIPE"));

    await expect(resultPromise).resolves.toMatchObject({
      exitCode: 1,
      stdout: "",
    });
  });
});

describe("handler", () => {
  it("returns a structured failure instead of throwing when the ARN is unset", async () => {
    // The workflow reads `ok` from the payload. A thrown handler surfaces as
    // FunctionError with a stack trace instead of an actionable message, so
    // misconfiguration must come back as data, not an exception.
    const previous = process.env.DIRECT_URL_SECRET_ARN;
    delete process.env.DIRECT_URL_SECRET_ARN;
    try {
      const result = await handler();
      expect(result.ok).toBe(false);
      expect(result.applied).toEqual([]);
      expect(result.error).toMatch(/DIRECT_URL_SECRET_ARN/);
    } finally {
      if (previous !== undefined) process.env.DIRECT_URL_SECRET_ARN = previous;
    }
  });

  it("spawns the prisma binary from the database package's own node_modules, not the task root's", async () => {
    // Regression coverage: the prisma bin only ever gets linked at
    // packages/database/node_modules/.bin/prisma. The root package.json has
    // no dependencies and nothing hoists a root-level bin, so
    // `${taskRoot}/node_modules/.bin/prisma` does not exist and every
    // invocation would fail with ENOENT. Capture the literal command
    // `run()` is invoked with via the spawnImpl seam and assert on the full
    // expected suffix, not just the word "prisma".
    class FakeStream extends EventEmitter {}
    class FakeChild extends EventEmitter {
      stdout = new FakeStream();
      stderr = new FakeStream();
    }
    const commands: string[] = [];
    const spawnImpl = (command: string) => {
      commands.push(command);
      const child = new FakeChild();
      queueMicrotask(() => child.emit("close", 0));
      return child;
    };

    const previousArn = process.env.DIRECT_URL_SECRET_ARN;
    const previousTaskRoot = process.env.LAMBDA_TASK_ROOT;
    process.env.DIRECT_URL_SECRET_ARN =
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:fake";
    process.env.LAMBDA_TASK_ROOT = "/var/task";
    try {
      const result = await handler(undefined, {
        spawnImpl,
        getDirectUrl: async () => "postgres://fake",
      });
      expect(result.ok).toBe(true);
      expect(commands).toEqual([
        "/var/task/packages/database/node_modules/.bin/prisma",
      ]);
    } finally {
      if (previousArn !== undefined) {
        process.env.DIRECT_URL_SECRET_ARN = previousArn;
      } else {
        delete process.env.DIRECT_URL_SECRET_ARN;
      }
      if (previousTaskRoot !== undefined) {
        process.env.LAMBDA_TASK_ROOT = previousTaskRoot;
      } else {
        delete process.env.LAMBDA_TASK_ROOT;
      }
    }
  });
});
