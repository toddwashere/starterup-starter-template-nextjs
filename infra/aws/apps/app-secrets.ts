import { secretsForApp } from "../../shared/secret-catalog";

/**
 * Pure, Pulumi-free ARN bag describing where each catalog secret and the
 * database URL secrets live. The AWS core stack derives `database-url`
 * separately (see `databaseUrlSecretArn`/`directUrlSecretArn`), so it is
 * absent from `catalogSecretArns`.
 */
export interface CatalogSecretArnBag {
  databaseUrlSecretArn: string;
  directUrlSecretArn: string;
  /** catalog id → ARN (no database-url) */
  catalogSecretArns: Readonly<Record<string, string>>;
}

/**
 * Resolve the ARN for a single catalog secret id, special-casing
 * `database-url` since it is not present in `catalogSecretArns`.
 * Throws if a required secret has no known ARN — never returns undefined, which
 * would silently produce an env var pointing at nothing.
 *
 * The message deliberately carries no app name: callers reach this from inside
 * a Pulumi `apply`, so the failing resource's URN is already in the error
 * output, and threading a context string through would be the only reason for
 * the parameter to exist.
 */
export function resolveSecretArn(id: string, arns: CatalogSecretArnBag): string {
  if (id === "database-url") return arns.databaseUrlSecretArn;
  const arn = arns.catalogSecretArns[id];
  if (!arn) throw new Error(`Missing catalogSecretArns[${id}]`);
  return arn;
}

/**
 * Builds the App Runner runtime secret env var → ARN map for a given app,
 * based on the shared secret catalog's `readers` list. Readers of the same
 * secret share the identical ARN string (no per-app copies).
 */
export function buildAppRunnerRuntimeSecrets(
  appName: string,
  arns: CatalogSecretArnBag,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const secret of secretsForApp(appName)) {
    out[secret.envVar] = resolveSecretArn(secret.id, arns);
  }
  return out;
}

/** Shared App Runner instance role: DB ARNs + every catalog placeholder ARN. */
export function appRunnerInstanceSecretArns(arns: CatalogSecretArnBag): string[] {
  return [
    arns.databaseUrlSecretArn,
    arns.directUrlSecretArn,
    ...Object.values(arns.catalogSecretArns),
  ];
}

/** Catalog secret ids the workers Lambda needs IAM access to. */
export function workersRuntimeSecretIds(): string[] {
  return secretsForApp("workers").map((s) => s.id);
}
