import type { SpawnOptions } from "node:child_process";

/**
 * Types for the plain-JavaScript `migrate-handler.mjs`.
 *
 * The handler stays `.mjs` on purpose (the Lambda RIC probes `<path>`, `.js`,
 * `.mjs`, `.cjs` and never `.ts`), and `tsconfig.json` only includes
 * `src/**\/*.ts`, so its `.ts` test importing it had no declarations and failed
 * `noImplicitAny` under `tsc --noEmit`. Declaring the surface here keeps the
 * runtime file untouched and avoids turning on `allowJs` for the package.
 */

export type MigrateRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type MigrateHandlerResult = {
  ok: boolean;
  exitCode: number;
  applied: string[];
  stdout: string;
  stderr: string;
  /** Present only on the structured-failure paths; the handler never throws. */
  error?: string;
};

/**
 * The slice of a spawned child `run()` actually touches: `stdout`/`stderr`
 * `data` + `error` events and the child's own `error`/`close`. Typed
 * structurally rather than as `ChildProcess` so the test's EventEmitter double
 * satisfies it without having to implement `stdin`, `stdio`, `kill`, and the
 * dozen other members of the real type.
 */
// Matches EventEmitter's own listener signature so an EventEmitter subclass is
// assignable here; a narrower parameter type is not (listeners compare
// contravariantly on their arguments).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ListenerLike = (...args: any[]) => void;

export type SpawnedProcessLike = {
  stdout: { on(event: string, listener: ListenerLike): unknown };
  stderr: { on(event: string, listener: ListenerLike): unknown };
  on(event: string, listener: ListenerLike): unknown;
};

export type SpawnLike = (
  command: string,
  args?: readonly string[],
  options?: SpawnOptions,
) => SpawnedProcessLike;

/** Test-only seams; Lambda's `context` never carries these keys. */
export type MigrateHandlerDeps = {
  spawnImpl?: SpawnLike;
  getDirectUrl?: (secretArn: string) => Promise<string | undefined>;
};

/** Pull migration names out of `prisma migrate deploy` stdout. */
export function parseAppliedMigrations(stdout: string): string[];

export function run(
  command: string,
  args: readonly string[],
  options?: SpawnOptions,
  spawnImpl?: SpawnLike,
): Promise<MigrateRunResult>;

export function handler(
  event?: unknown,
  deps?: MigrateHandlerDeps,
): Promise<MigrateHandlerResult>;
