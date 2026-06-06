export interface DatabaseUrlParts {
  /** DB username. */
  user: string;
  /** DB password (already URL-safe; callers pass the raw secret value). */
  password: string;
  /** Database name. */
  dbName: string;
  /** Private IP of the Cloud SQL instance; "" when the instance is public-only. */
  privateIp: string;
  /** Cloud SQL connection name (project:region:instance) for the socket form. */
  connectionName: string;
}

/**
 * Composes the Postgres connection string stored as the `database-url` secret.
 *
 * - Private networking (privateIp present): direct TCP via the VPC.
 * - Public/sandbox (privateIp empty): Cloud SQL Auth Proxy unix socket mounted
 *   by Cloud Run at /cloudsql/<connectionName>.
 *
 * Pure function over plain strings so it is unit-testable; callers `apply`
 * the database stack's secret outputs before invoking it.
 */
export function composeDatabaseUrl(parts: DatabaseUrlParts): string {
  const { user, password, dbName, privateIp, connectionName } = parts;
  if (privateIp.length > 0) {
    return `postgresql://${user}:${password}@${privateIp}/${dbName}`;
  }
  return `postgresql://${user}:${password}@/${dbName}?host=/cloudsql/${connectionName}`;
}
