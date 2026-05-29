export interface AppDescriptor {
  name: string;
  packageName: string;
  port: number;
  healthPath: string;
  dockerfile: string;
}

export const APPS: readonly AppDescriptor[] = [
  {
    name: "dashboard",
    packageName: "@apps/dashboard",
    port: 4000,
    healthPath: "/api/health",
    dockerfile: "infra/shared/docker/Dockerfile.dashboard",
  },
  {
    name: "www",
    packageName: "@apps/www",
    port: 4001,
    healthPath: "/api/health",
    dockerfile: "infra/shared/docker/Dockerfile.www",
  },
  {
    name: "public-api",
    packageName: "@apps/public-api",
    port: 4002,
    healthPath: "/health",
    dockerfile: "infra/shared/docker/Dockerfile.public-api",
  },
  {
    name: "public-mcp",
    packageName: "@apps/public-mcp",
    port: 4003,
    healthPath: "/health",
    dockerfile: "infra/shared/docker/Dockerfile.public-mcp",
  },
  {
    name: "workers",
    packageName: "@apps/workers",
    port: 4300,
    healthPath: "/health",
    dockerfile: "apps/workers/Dockerfile",
  },
] as const;

export const APPS_BY_NAME: Readonly<Record<string, AppDescriptor>> =
  Object.fromEntries(APPS.map((app) => [app.name, app]));
