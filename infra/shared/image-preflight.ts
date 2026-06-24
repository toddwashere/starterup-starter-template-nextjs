import { APPS } from "./apps.manifest";

export interface CloudRunImageRef {
  app: string;
  image: string;
}

/** Image refs deployed to Cloud Run (`{registry}/{app}:{tag}`). */
export function cloudRunImageRefs(registry: string, tag: string): CloudRunImageRef[] {
  const base = registry.replace(/\/$/, "");
  return APPS.map((app) => ({
    app: app.name,
    image: `${base}/${app.name}:${tag}`,
  }));
}

export function missingImageRefs(
  refs: readonly CloudRunImageRef[],
  exists: (image: string) => boolean,
): CloudRunImageRef[] {
  return refs.filter((ref) => !exists(ref.image));
}
