import type { AppDescriptor } from "./apps.manifest";
import { secretsForApp } from "./secret-catalog";

export interface AppIamPlan {
  app: string;
  roles: string[];
  secretAccessorIds: string[];
}

export function planAppIam(app: AppDescriptor): AppIamPlan {
  const roles: string[] = [];
  if (app.needsDb) roles.push("roles/cloudsql.client");
  if (app.needsPubsub || app.worker) {
    roles.push("roles/pubsub.publisher", "roles/pubsub.subscriber");
  }
  if (app.needsStorage) roles.push("roles/storage.objectAdmin");
  return {
    app: app.name,
    roles,
    secretAccessorIds: secretsForApp(app.name).map((s) => s.id),
  };
}
