import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config("gcp");
const region = config.require("region");
const project = config.require("project");

// TODO Task 3.2: Cloud SQL Postgres
// TODO Task 3.2: Pub/Sub topic + DLQ
// TODO Task 3.2: Secret Manager

export const projectId = project;
export const regionOutput = region;
export const databaseUrl: pulumi.Output<string> = pulumi.secret("placeholder://configure-in-task-3.2");
export const pubsubTopicName: pulumi.Output<string> = pulumi.output("placeholder-task-3.2");
