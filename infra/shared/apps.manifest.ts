export interface AppDescriptor {
  name: string;
  packageName: string;
  port: number;
  healthPath: string;
  dockerfile: string;
  public: boolean;
  worker: boolean;
  needsDb: boolean;
  needsPubsub: boolean;
  needsStorage: boolean;
  usesRedis: boolean;
}

export const APPS: readonly AppDescriptor[] = [
  {
    name: "dashboard",
    packageName: "@apps/dashboard",
    port: 4000,
    healthPath: "/api/health",
    dockerfile: "infra/shared/docker/Dockerfile.dashboard",
    public: true,
    worker: false,
    needsDb: true,
    needsPubsub: false,
    needsStorage: true,
    usesRedis: true,
  },
  {
    name: "www",
    packageName: "@apps/www",
    port: 4001,
    healthPath: "/api/health",
    dockerfile: "infra/shared/docker/Dockerfile.www",
    public: true,
    worker: false,
    needsDb: false,
    needsPubsub: false,
    needsStorage: false,
    usesRedis: false,
  },
  {
    name: "public-api",
    packageName: "@apps/public-api",
    port: 4002,
    healthPath: "/health",
    dockerfile: "infra/shared/docker/Dockerfile.public-api",
    public: true,
    worker: false,
    needsDb: true,
    needsPubsub: true,
    needsStorage: true,
    usesRedis: false,
  },
  {
    name: "public-mcp",
    packageName: "@apps/public-mcp",
    port: 4003,
    healthPath: "/health",
    dockerfile: "infra/shared/docker/Dockerfile.public-mcp",
    public: true,
    worker: false,
    needsDb: true,
    needsPubsub: false,
    needsStorage: false,
    usesRedis: false,
  },
  {
    name: "workers",
    packageName: "@apps/workers",
    port: 4300,
    healthPath: "/health",
    dockerfile: "apps/workers/Dockerfile",
    public: false,
    worker: true,
    needsDb: true,
    needsPubsub: true,
    needsStorage: true,
    usesRedis: false,
  },
] as const;

export const APPS_BY_NAME: Readonly<Record<string, AppDescriptor>> =
  Object.fromEntries(APPS.map((app) => [app.name, app]));
