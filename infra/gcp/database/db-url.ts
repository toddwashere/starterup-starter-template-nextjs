export interface DatabaseUrlParts {
  /** DB user name. */
  user: string;
  /** DB user password (plaintext; callers pass a resolved secret). */
  password: string;
  /** Logical database name. */
  dbName: string;
  /** Private IP of the instance; "" when the instance is public. */
  privateIp: string;
  /** Cloud SQL connection name (project:region:instance) for the proxy socket. */
  connectionName: string;
}

/**
 * Composes a Postgres `DATABASE_URL`.
 *
 * - Private (privateIp non-empty): direct TCP via the VPC-routed private IP.
 * - Public (privateIp ""): Cloud SQL Auth Proxy unix socket mounted at
 *   `/cloudsql/<connectionName>` (the sandbox path; no public IPv4 dialing).
 */
export function composeDatabaseUrl(parts: DatabaseUrlParts): string {
  const { user, password, dbName, privateIp, connectionName } = parts;
  if (privateIp !== "") {
    return `postgresql://${user}:${password}@${privateIp}/${dbName}`;
  }
  return `postgresql://${user}:${password}@/${dbName}?host=/cloudsql/${connectionName}`;
}
