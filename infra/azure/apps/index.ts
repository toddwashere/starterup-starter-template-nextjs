import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure-native";

const config = new pulumi.Config();
const coreStackRef = config.require("coreStackRef");
const imageRegistry = config.require("imageRegistry"); // e.g., platform.azurecr.io
const imageTag = config.get("imageTag") ?? "latest";

const coreStack = new pulumi.StackReference(coreStackRef);
const resourceGroupName = coreStack.getOutput("resourceGroupName");
const locationOutput = coreStack.getOutput("locationOutput");
const databaseUrl = coreStack.getOutput("databaseUrl");
const serviceBusConnectionString = coreStack.getOutput("serviceBusConnectionString");
const serviceBusQueueName = coreStack.getOutput("serviceBusQueueName");

// --- Container Apps Environment -------------------------------------------
const env = new azure.app.ManagedEnvironment("starter-env", {
  resourceGroupName,
  environmentName: pulumi.interpolate`platform-env-${pulumi.getStack()}`,
  location: locationOutput,
  // sandbox: no Log Analytics workspace required for Consumption tier
});

interface AppDeploy {
  name: string;
  port: number;
  image: pulumi.Input<string>;
  external?: boolean;
  needsServiceBus?: boolean;
}

const apps: AppDeploy[] = [
  { name: "dashboard",  port: 4000, image: pulumi.interpolate`${imageRegistry}/dashboard:${imageTag}`,  external: true },
  { name: "www",        port: 4001, image: pulumi.interpolate`${imageRegistry}/www:${imageTag}`,        external: true },
  { name: "public-api", port: 4002, image: pulumi.interpolate`${imageRegistry}/public-api:${imageTag}`, external: true },
  { name: "public-mcp", port: 4003, image: pulumi.interpolate`${imageRegistry}/public-mcp:${imageTag}`, external: true },
  { name: "workers",    port: 4300, image: pulumi.interpolate`${imageRegistry}/workers:${imageTag}`,    needsServiceBus: true },
];

for (const app of apps) {
  new azure.app.ContainerApp(app.name, {
    resourceGroupName,
    containerAppName: `platform-${app.name}`,
    location: locationOutput,
    managedEnvironmentId: env.id,
    configuration: app.external
      ? {
          ingress: {
            external: true,
            targetPort: app.port,
            transport: "auto",
          },
        }
      : { ingress: undefined },
    template: {
      scale: { minReplicas: 0, maxReplicas: 2 },
      containers: [
        {
          name: app.name,
          image: app.image,
          resources: { cpu: 0.25, memory: "0.5Gi" },
          env: [
            { name: "PORT", value: String(app.port) },
            { name: "WORKER_QUEUE_ADAPTER", value: "servicebus" },
            { name: "DATABASE_URL", value: databaseUrl as unknown as string },
            ...(app.needsServiceBus
              ? [
                  {
                    name: "SERVICEBUS_CONNECTION_STRING",
                    value: serviceBusConnectionString as unknown as string,
                  },
                  {
                    name: "SERVICEBUS_QUEUE_NAME",
                    value: serviceBusQueueName as unknown as string,
                  },
                ]
              : []),
          ],
        },
      ],
    },
  });
}
