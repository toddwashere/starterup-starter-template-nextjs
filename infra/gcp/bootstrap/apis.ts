import * as gcp from "@pulumi/gcp";

/** Every API any layer needs, enabled up-front in bootstrap. */
export const REQUIRED_APIS: readonly string[] = [
  "cloudresourcemanager.googleapis.com",
  "serviceusage.googleapis.com",
  "iam.googleapis.com",
  "iamcredentials.googleapis.com",
  "sts.googleapis.com",
  "compute.googleapis.com",
  "run.googleapis.com",
  "sqladmin.googleapis.com",
  "pubsub.googleapis.com",
  "secretmanager.googleapis.com",
  "artifactregistry.googleapis.com",
  "vpcaccess.googleapis.com",
  "servicenetworking.googleapis.com",
  "redis.googleapis.com",
  "cloudkms.googleapis.com",
  "monitoring.googleapis.com",
  "logging.googleapis.com",
  "certificatemanager.googleapis.com",
  "binaryauthorization.googleapis.com",
  "orgpolicy.googleapis.com",
  "essentialcontacts.googleapis.com",
  "billingbudgets.googleapis.com",
  "cloudbilling.googleapis.com",
];

/**
 * Enables every required API. Returns the Service resources so other resources
 * can `dependsOn` them and never race a not-yet-active API.
 */
export function enableApis(project: string): gcp.projects.Service[] {
  return REQUIRED_APIS.map(
    (api) =>
      new gcp.projects.Service(`api-${api.split(".")[0]}`, {
        project,
        service: api,
        disableOnDestroy: false,
        disableDependentServices: false,
      }),
  );
}
