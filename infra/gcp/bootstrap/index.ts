import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { enableApis } from "./apis";

const config = new pulumi.Config();
const gcpConfig = new pulumi.Config("gcp");
const project = gcpConfig.require("project");
const region = gcpConfig.require("region");

const privateNetwork = config.getBoolean("privateNetwork") ?? false;
const vpcCidr = config.get("vpcCidr") ?? "10.10.0.0/24";
const complianceMode = config.get("complianceMode") ?? "none";
const budgetAmount = config.get("budgetAmount");
const billingAccountId = config.get("billingAccountId");

// --- 1. Enable all APIs first; everything else dependsOn these. ---------------
const apis = enableApis(project);

// --- 2. VPC + connector + private services access (when privateNetwork). ------
const network = privateNetwork
  ? new gcp.compute.Network("starter-vpc", { autoCreateSubnetworks: false }, { dependsOn: apis })
  : undefined;

const subnet = network
  ? new gcp.compute.Subnetwork("starter-subnet", {
      network: network.id,
      region,
      ipCidrRange: vpcCidr,
      privateIpGoogleAccess: true,
    })
  : undefined;

const vpcConnector = network
  ? new gcp.vpcaccess.Connector("starter-connector", {
      region,
      network: network.name,
      ipCidrRange: "10.20.0.0/28",
      minThroughput: 200,
      maxThroughput: 300,
    })
  : undefined;

const psaRange = network
  ? new gcp.compute.GlobalAddress("starter-psa", {
      purpose: "VPC_PEERING",
      addressType: "INTERNAL",
      prefixLength: 16,
      network: network.id,
    })
  : undefined;

const psa =
  network && psaRange
    ? new gcp.servicenetworking.Connection("starter-psa-conn", {
        network: network.id,
        service: "servicenetworking.googleapis.com",
        reservedPeeringRanges: [psaRange.name],
      })
    : undefined;

// --- 3. Artifact Registry repository for app images. --------------------------
const repo = new gcp.artifactregistry.Repository(
  "starter-images",
  {
    location: region,
    repositoryId: "starter",
    format: "DOCKER",
    description: "Container images for the SaaS starter apps",
  },
  { dependsOn: apis },
);

// --- 4. Deploy service account + Workload Identity Federation. ----------------
const deploySa = new gcp.serviceaccount.Account(
  "deploy-sa",
  {
    accountId: "github-deploy",
    displayName: "GitHub Actions deploy identity",
  },
  { dependsOn: apis },
);

const DEPLOY_ROLES = [
  "roles/run.admin",
  "roles/cloudsql.client",
  "roles/artifactregistry.writer",
  "roles/secretmanager.admin",
  "roles/iam.serviceAccountUser",
];

DEPLOY_ROLES.forEach((role, i) => {
  new gcp.projects.IAMMember(`deploy-sa-role-${i}`, {
    project,
    role,
    member: pulumi.interpolate`serviceAccount:${deploySa.email}`,
  });
});

const wifPool = new gcp.iam.WorkloadIdentityPool(
  "github-pool",
  { workloadIdentityPoolId: "github", displayName: "GitHub Actions" },
  { dependsOn: apis },
);

const wifProvider = new gcp.iam.WorkloadIdentityPoolProvider("github-provider", {
  workloadIdentityPoolId: wifPool.workloadIdentityPoolId,
  workloadIdentityPoolProviderId: "github",
  displayName: "GitHub OIDC",
  attributeMapping: {
    "google.subject": "assertion.sub",
    "attribute.repository": "assertion.repository",
  },
  oidc: { issuerUri: "https://token.actions.githubusercontent.com" },
});

// --- 5. Billing budget (only when a billing account id is provided). ----------
if (billingAccountId && budgetAmount) {
  new gcp.billing.Budget(
    "starter-budget",
    {
      billingAccount: billingAccountId,
      displayName: pulumi.interpolate`starter-budget-${pulumi.getStack()}`,
      budgetFilter: { projects: [pulumi.interpolate`projects/${project}`] },
      amount: { specifiedAmount: { currencyCode: "USD", units: budgetAmount } },
      thresholdRules: [
        { thresholdPercent: 0.2 },
        { thresholdPercent: 0.5 },
        { thresholdPercent: 1.0 },
      ],
    },
    { dependsOn: apis },
  );
}

// --- Exports (locked contract — see plan header). -----------------------------
export const projectId = project;
export const regionOut = region;
export const networkId = network ? network.id : pulumi.output("");
export const networkSelfLink = network ? network.selfLink : pulumi.output("");
export const subnetSelfLink = subnet ? subnet.selfLink : pulumi.output("");
export const vpcConnectorId = vpcConnector ? vpcConnector.id : pulumi.output("");
export const privateServicesConnection = psa ? psa.id : pulumi.output("");
export const artifactRegistryRepo = pulumi.interpolate`${region}-docker.pkg.dev/${project}/${repo.repositoryId}`;
export const deployServiceAccountEmail = deploySa.email;
export const workloadIdentityProvider = wifProvider.name;
export const complianceModeOut = complianceMode;
