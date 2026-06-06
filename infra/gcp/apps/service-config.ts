import type { AppDescriptor } from "../../shared/apps.manifest";
import { APPS } from "../../shared/apps.manifest";
import { planAppIam } from "../../shared/app-iam";
import { secretsForApp } from "../../shared/secret-catalog";

export interface EnvContext {
  projectId: string;
  pubsubTopic: string;
  redisHost: string;
  redisPort: number;
  uploadsBucket: string;
}

/** A Cloud Run env var: either a literal value or a Secret Manager reference id. */
export interface AppEnvVar {
  name: string;
  /** Literal value, when this is a plain env var. */
  value?: string;
  /** Secret catalog id to source from (resolved to a secretKeyRef in index.ts). */
  fromSecretId?: string;
  /** True when this env should come from the composed DATABASE_URL secret. */
  databaseUrl?: boolean;
}

export function buildAppEnv(app: AppDescriptor, ctx: EnvContext): AppEnvVar[] {
  const env: AppEnvVar[] = [{ name: "PORT", value: String(app.port) }];

  if (app.needsDb) {
    env.push({ name: "DATABASE_URL", databaseUrl: true });
  }

  for (const secret of secretsForApp(app.name)) {
    if (secret.id === "database-url") continue; // handled above
    env.push({ name: secret.envVar, fromSecretId: secret.id });
  }

  if (app.needsPubsub || app.worker) {
    env.push({ name: "PUBSUB_TOPIC", value: ctx.pubsubTopic });
    env.push({ name: "GCP_PROJECT_ID", value: ctx.projectId });
    env.push({ name: "WORKER_QUEUE_ADAPTER", value: "pubsub" });
    env.push({ name: "BULLMQ_QUEUE_NAME", value: "jobs" });
  }

  if (app.usesRedis && ctx.redisHost) {
    env.push({ name: "REDIS_URL", value: `redis://${ctx.redisHost}:${ctx.redisPort}` });
  }

  if (app.needsStorage && ctx.uploadsBucket) {
    env.push({ name: "GCS_UPLOADS_BUCKET", value: ctx.uploadsBucket });
  }

  return env;
}

export function appRoles(app: AppDescriptor): string[] {
  return planAppIam(app).roles;
}

export function appSecretAccessorIds(app: AppDescriptor): string[] {
  return planAppIam(app).secretAccessorIds;
}

export function publicInvokerApps(): AppDescriptor[] {
  return APPS.filter((a) => a.public);
}
