import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
const coreStackRef = config.require("coreStackRef");
const imageRegistry = config.require("imageRegistry");

const coreStack = new pulumi.StackReference(coreStackRef);

// Read core outputs (consumed by Cloud Run services in Task 3.2).
const databaseUrl = coreStack.getOutput("databaseUrl");
const pubsubTopicName = coreStack.getOutput("pubsubTopicName");
const projectId = coreStack.getOutput("projectId");
const regionOutput = coreStack.getOutput("regionOutput");

// TODO Task 3.2: Cloud Run services for dashboard, www, public-api, public-mcp, workers
// Each will read from imageRegistry + databaseUrl + pubsubTopicName.

export const placeholder = pulumi.all([databaseUrl, pubsubTopicName, projectId, regionOutput]).apply(
  ([dbUrl, topic, pid, region]) => `Apps stack scaffold — core: ${pid}/${region}; db secret length ${dbUrl.length}; topic ${topic}`,
);
