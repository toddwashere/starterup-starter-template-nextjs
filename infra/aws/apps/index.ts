import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const config = new pulumi.Config();
const coreStackRef = config.require("coreStackRef");
const imageRegistry = config.require("imageRegistry"); // ECR registry URL
const imageTag = config.get("imageTag") ?? "latest";

const coreStack = new pulumi.StackReference(coreStackRef);
const regionOutput = coreStack.getOutput("regionOutput");
const databaseUrlSecretArn = coreStack.getOutput("databaseUrlSecretArn");
const sqsQueueUrl = coreStack.getOutput("sqsQueueUrl");

// --- Cluster ---------------------------------------------------------------
const cluster = new aws.ecs.Cluster("starter", {
  name: pulumi.interpolate`starter-${pulumi.getStack()}`,
});

// --- Default VPC for sandbox (no NAT) -------------------------------------
const vpc = aws.ec2.getVpcOutput({ default: true });
const subnets = aws.ec2.getSubnetsOutput({
  filters: [{ name: "vpc-id", values: [vpc.id] }],
});

const sg = new aws.ec2.SecurityGroup("starter-tasks-sg", {
  vpcId: vpc.id,
  description: "Starter Fargate task security group",
  egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
  ingress: [], // sandbox: no inbound LB; reach via public IP (not for prod)
});

// --- Task execution role ---------------------------------------------------
const execRole = new aws.iam.Role("starter-exec", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: "ecs-tasks.amazonaws.com" }),
});
new aws.iam.RolePolicyAttachment("starter-exec-policy", {
  role: execRole.name,
  policyArn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
});

// Allow reading the database-url secret.
new aws.iam.RolePolicy("starter-exec-secrets", {
  role: execRole.id,
  policy: pulumi.jsonStringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["secretsmanager:GetSecretValue"],
        Resource: databaseUrlSecretArn,
      },
    ],
  }),
});

// --- Task role (workers need SQS) -----------------------------------------
const workerTaskRole = new aws.iam.Role("starter-workers-task", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: "ecs-tasks.amazonaws.com" }),
});
new aws.iam.RolePolicy("starter-workers-sqs", {
  role: workerTaskRole.id,
  policy: pulumi.jsonStringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
        Resource: "*",
      },
      { Effect: "Allow", Action: ["sqs:SendMessage"], Resource: "*" },
    ],
  }),
});

// --- Service factory -------------------------------------------------------
interface AppDeploy {
  name: string;
  port: number;
  image: pulumi.Input<string>;
  taskRole?: aws.iam.Role;
  needsSqs?: boolean;
}

const apps: AppDeploy[] = [
  {
    name: "dashboard",
    port: 4000,
    image: pulumi.interpolate`${imageRegistry}/dashboard:${imageTag}`,
  },
  { name: "www", port: 4001, image: pulumi.interpolate`${imageRegistry}/www:${imageTag}` },
  {
    name: "public-api",
    port: 4002,
    image: pulumi.interpolate`${imageRegistry}/public-api:${imageTag}`,
  },
  {
    name: "public-mcp",
    port: 4003,
    image: pulumi.interpolate`${imageRegistry}/public-mcp:${imageTag}`,
  },
  {
    name: "workers",
    port: 4300,
    image: pulumi.interpolate`${imageRegistry}/workers:${imageTag}`,
    taskRole: workerTaskRole,
    needsSqs: true,
  },
];

for (const app of apps) {
  const td = new aws.ecs.TaskDefinition(`${app.name}-td`, {
    family: `starter-${app.name}`,
    cpu: "256",
    memory: "512",
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    executionRoleArn: execRole.arn,
    taskRoleArn: app.taskRole?.arn,
    containerDefinitions: pulumi.jsonStringify([
      {
        name: app.name,
        image: app.image,
        portMappings: [{ containerPort: app.port, protocol: "tcp" }],
        secrets: [{ name: "DATABASE_URL", valueFrom: databaseUrlSecretArn }],
        environment: [
          { name: "PORT", value: String(app.port) },
          { name: "WORKER_QUEUE_ADAPTER", value: "sqs" },
          ...(app.needsSqs ? [{ name: "SQS_QUEUE_URL", value: sqsQueueUrl }] : []),
        ],
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": `/starter/${app.name}`,
            "awslogs-region": regionOutput,
            "awslogs-stream-prefix": app.name,
            "awslogs-create-group": "true",
          },
        },
      },
    ]),
  });

  new aws.ecs.Service(app.name, {
    name: `starter-${app.name}`,
    cluster: cluster.id,
    taskDefinition: td.arn,
    desiredCount: 1,
    launchType: "FARGATE",
    networkConfiguration: {
      subnets: subnets.ids,
      securityGroups: [sg.id],
      assignPublicIp: true, // sandbox: no NAT; tasks reach internet via public IP
    },
  });
}
