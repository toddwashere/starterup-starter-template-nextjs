export function buildPoolerDatabaseUrl(args: {
  username: string;
  password: string;
  hostname: string;
  database: string;
}): string {
  return `postgresql://${encodeURIComponent(args.username)}:${encodeURIComponent(
    args.password,
  )}@${args.hostname}:6432/${encodeURIComponent(args.database)}?sslmode=verify-full`;
}
