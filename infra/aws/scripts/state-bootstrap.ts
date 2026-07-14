#!/usr/bin/env tsx

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  backendUrl,
  cloudFormationDeployArgs,
  iamRoleArnFromCallerArn,
  nextCommands,
  resolveStateBootstrapConfig,
  secretsProviderUrl,
  stateNames,
  type StateBootstrapConfig,
} from "./state-orchestration";

export interface CallerIdentity {
  Account: string;
  Arn: string;
  UserId: string;
}

interface StackOutput {
  OutputKey: string;
  OutputValue: string;
}

export interface StateBootstrapRunner {
  run(program: string, args: readonly string[], profile: string, region: string): void;
  capture(program: string, args: readonly string[], profile: string, region: string): string;
}

export interface StateBootstrapResult {
  stateIdentity: CallerIdentity;
  workloadIdentity: CallerIdentity;
  backend: string;
  secretsProvider: string;
}

function commandEnv(profile: string, region: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    AWS_PROFILE: profile,
    AWS_REGION: region,
    AWS_DEFAULT_REGION: region,
  };
}

const commandRunner: StateBootstrapRunner = {
  run(program, args, profile, region) {
    execFileSync(program, [...args], {
      stdio: "inherit",
      env: commandEnv(profile, region),
    });
  },
  capture(program, args, profile, region) {
    return execFileSync(program, [...args], {
      encoding: "utf8",
      env: commandEnv(profile, region),
    }).trim();
  },
};

function callerIdentity(
  runner: StateBootstrapRunner,
  profile: string,
  region: string,
): CallerIdentity {
  return JSON.parse(
    runner.capture("aws", ["sts", "get-caller-identity", "--output", "json"], profile, region),
  ) as CallerIdentity;
}

function requireExpectedAccount(
  identity: CallerIdentity,
  expectedAccountId: string,
  profile: string,
  purpose: string,
): void {
  if (identity.Account !== expectedAccountId) {
    throw new Error(
      `${purpose} profile "${profile}" resolves to account ${identity.Account}; ` +
        `expected ${expectedAccountId}. Refusing to continue.`,
    );
  }
}

function outputsByKey(outputs: readonly StackOutput[]): Record<string, string> {
  return Object.fromEntries(outputs.map((output) => [output.OutputKey, output.OutputValue]));
}

export function executeStateBootstrap(input: {
  config: StateBootstrapConfig;
  runner: StateBootstrapRunner;
  templatePath: string;
  probeId?: string;
}): StateBootstrapResult {
  const { config, runner, templatePath } = input;
  const names = stateNames(config);
  const stateIdentity = callerIdentity(runner, config.stateProfile, config.region);
  const workloadIdentity = callerIdentity(runner, config.workloadProfile, config.region);
  requireExpectedAccount(stateIdentity, config.stateAccountId, config.stateProfile, "State");
  requireExpectedAccount(
    workloadIdentity,
    config.workloadAccountId,
    config.workloadProfile,
    "Workload",
  );

  const workloadAdminRoleArn = iamRoleArnFromCallerArn(workloadIdentity.Arn, config.ssoRegion);
  runner.run(
    "aws",
    cloudFormationDeployArgs(config, workloadAdminRoleArn, templatePath),
    config.stateProfile,
    config.region,
  );

  const stackOutputs = JSON.parse(
    runner.capture(
      "aws",
      [
        "cloudformation",
        "describe-stacks",
        "--stack-name",
        names.stackName,
        "--query",
        "Stacks[0].Outputs",
        "--output",
        "json",
      ],
      config.stateProfile,
      config.region,
    ),
  ) as StackOutput[];
  const outputs = outputsByKey(stackOutputs);
  const stateBucketName = outputs.StateBucketName;
  const kmsKeyArn = outputs.KmsKeyArn;
  if (!stateBucketName || !kmsKeyArn) {
    throw new Error("CloudFormation did not return StateBucketName and KmsKeyArn outputs.");
  }

  runner.run(
    "aws",
    ["s3api", "head-bucket", "--bucket", stateBucketName],
    config.workloadProfile,
    config.region,
  );
  runner.run(
    "aws",
    ["kms", "describe-key", "--key-id", kmsKeyArn],
    config.workloadProfile,
    config.region,
  );

  const probeKey = `.pulumi/access-probe-${input.probeId ?? randomUUID()}`;
  const probeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "pulumi-state-probe-"));
  const uploadPath = path.join(probeDirectory, "upload");
  const downloadPath = path.join(probeDirectory, "download");
  fs.writeFileSync(uploadPath, "");
  let probeCreated = false;
  try {
    runner.run(
      "aws",
      ["s3api", "put-object", "--bucket", stateBucketName, "--key", probeKey, "--body", uploadPath],
      config.workloadProfile,
      config.region,
    );
    probeCreated = true;
    runner.run(
      "aws",
      ["s3api", "get-object", "--bucket", stateBucketName, "--key", probeKey, downloadPath],
      config.workloadProfile,
      config.region,
    );
    const encryptedDataKey = runner.capture(
      "aws",
      [
        "kms",
        "generate-data-key-without-plaintext",
        "--key-id",
        kmsKeyArn,
        "--key-spec",
        "AES_256",
        "--query",
        "CiphertextBlob",
        "--output",
        "text",
      ],
      config.workloadProfile,
      config.region,
    );
    runner.capture(
      "aws",
      [
        "kms",
        "decrypt",
        "--ciphertext-blob",
        encryptedDataKey,
        "--key-id",
        kmsKeyArn,
        "--output",
        "json",
      ],
      config.workloadProfile,
      config.region,
    );
  } finally {
    if (probeCreated) {
      runner.run(
        "aws",
        ["s3api", "delete-object", "--bucket", stateBucketName, "--key", probeKey],
        config.workloadProfile,
        config.region,
      );
    }
    fs.rmSync(probeDirectory, { recursive: true, force: true });
  }

  const pulumiBackend = backendUrl(stateBucketName, config.region);
  const pulumiSecretsProvider = secretsProviderUrl(kmsKeyArn, config.region);
  runner.run("pulumi", ["login", pulumiBackend], config.workloadProfile, config.region);

  return {
    stateIdentity,
    workloadIdentity,
    backend: pulumiBackend,
    secretsProvider: pulumiSecretsProvider,
  };
}

function usage(): string {
  return [
    "Usage:",
    "  pnpm infra:aws:state init <sandbox|staging|production> [options]",
    "",
    "Options:",
    "  --state-profile <name>",
    "  --workload-profile <name>",
    "  --state-account-id <12 digits>",
    "  --workload-account-id <12 digits>",
    "  --resource-prefix <s3-safe prefix>",
    "  --sso-region <identity center region>",
    "",
    "Defaults come from infra/.env.local. AWS_STATE_RESOURCE_PREFIX is required.",
  ].join("\n");
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return;
  }

  const config = resolveStateBootstrapConfig(argv, process.env);
  const templatePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../state-bootstrap/pulumi-state.cfn.yaml",
  );
  console.log("Verifying AWS account boundaries...");
  console.log(
    `Deploying retained ${config.environment} state foundation to account ${config.stateAccountId}...`,
  );
  const result = executeStateBootstrap({
    config,
    runner: commandRunner,
    templatePath,
  });

  console.log("\nState foundation is ready.");
  console.log(`State account: ${result.stateIdentity.Account}`);
  console.log(`Workload account: ${result.workloadIdentity.Account}`);
  console.log(`Backend: ${result.backend}`);
  console.log(`Secrets provider: ${result.secretsProvider}`);
  if (process.env.PULUMI_ORG?.trim() !== "organization") {
    console.warn("\nSet PULUMI_ORG=organization in infra/.env.local before using the apps stack.");
  }
  console.log(
    `\n${nextCommands({
      environment: config.environment,
      workloadProfile: config.workloadProfile,
      secretsProvider: result.secretsProvider,
    })}`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(
      `AWS state bootstrap failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
