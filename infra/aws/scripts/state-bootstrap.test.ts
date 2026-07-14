import { describe, expect, it } from "vitest";
import { executeStateBootstrap, type StateBootstrapRunner } from "./state-bootstrap";
import { resolveStateBootstrapConfig } from "./state-orchestration";

describe("executeStateBootstrap", () => {
  it("validates both accounts before mutation and never executes Pulumi layers", () => {
    const calls: Array<{
      mode: "run" | "capture";
      program: string;
      args: readonly string[];
      profile: string;
    }> = [];
    const runner: StateBootstrapRunner = {
      run(program, args, profile) {
        calls.push({ mode: "run", program, args, profile });
      },
      capture(program, args, profile) {
        calls.push({ mode: "capture", program, args, profile });
        const command = args.join(" ");
        if (command.startsWith("sts get-caller-identity")) {
          return JSON.stringify({
            Account: profile === "starter-state" ? "444455556666" : "111122223333",
            Arn:
              profile === "starter-state"
                ? "arn:aws:sts::444455556666:assumed-role/AdministratorAccess/state-operator"
                : "arn:aws:sts::111122223333:assumed-role/AWSReservedSSO_AdministratorAccess_example/operator",
            UserId: "example",
          });
        }
        if (command.startsWith("cloudformation describe-stacks")) {
          return JSON.stringify([
            {
              OutputKey: "StateBucketName",
              OutputValue: "inthealth-cross-account-state-sandbox-444455556666-us-east-2",
            },
            {
              OutputKey: "KmsKeyArn",
              OutputValue: "arn:aws:kms:us-east-2:444455556666:key/example",
            },
          ]);
        }
        if (command.startsWith("kms generate-data-key-without-plaintext")) {
          return "encrypted-data-key";
        }
        if (command.startsWith("kms decrypt")) return "{}";
        throw new Error(`Unexpected capture command: ${program} ${command}`);
      },
    };
    const config = resolveStateBootstrapConfig(["init", "sandbox"], {
      AWS_STATE_ACCOUNT_ID: "444455556666",
      AWS_STATE_PROFILE: "starter-state",
      AWS_STATE_RESOURCE_PREFIX: "inthealth-cross-account-state",
      AWS_SANDBOX_ACCOUNT_ID: "111122223333",
    });

    executeStateBootstrap({
      config,
      runner,
      templatePath: "/repo/pulumi-state.cfn.yaml",
      probeId: "test",
    });

    const commands = calls.map((call) => `${call.program} ${call.args.join(" ")}`);
    const deployIndex = commands.findIndex((command) =>
      command.startsWith("aws cloudformation deploy"),
    );
    expect(commands[0]).toContain("sts get-caller-identity");
    expect(commands[1]).toContain("sts get-caller-identity");
    expect(deployIndex).toBeGreaterThan(1);
    expect(calls[deployIndex].profile).toBe("starter-state");
    expect(commands).toEqual(
      expect.arrayContaining([
        expect.stringContaining("s3api put-object"),
        expect.stringContaining("s3api get-object"),
        expect.stringContaining("s3api delete-object"),
        expect.stringContaining("kms generate-data-key-without-plaintext"),
        expect.stringContaining("kms decrypt"),
        expect.stringContaining("pulumi login s3://"),
      ]),
    );
    expect(commands.join("\n")).not.toMatch(/pulumi (stack init|up)/);
    expect(calls.at(-1)?.profile).toBe("starter-sandbox");
  });

  it("refuses to mutate when either profile resolves to the wrong account", () => {
    const mutations: string[] = [];
    const runner: StateBootstrapRunner = {
      run(program, args) {
        mutations.push(`${program} ${args.join(" ")}`);
      },
      capture(_program, args, profile) {
        if (args[0] !== "sts") throw new Error("Mutation was reached");
        return JSON.stringify({
          Account: profile === "starter-state" ? "444455556666" : "999999999999",
          Arn: `arn:aws:sts::999999999999:assumed-role/AdministratorAccess/operator`,
          UserId: "example",
        });
      },
    };
    const config = resolveStateBootstrapConfig(["init", "sandbox"], {
      AWS_STATE_ACCOUNT_ID: "444455556666",
      AWS_STATE_PROFILE: "starter-state",
      AWS_STATE_RESOURCE_PREFIX: "inthealth-cross-account-state",
      AWS_SANDBOX_ACCOUNT_ID: "111122223333",
    });

    expect(() =>
      executeStateBootstrap({
        config,
        runner,
        templatePath: "/repo/pulumi-state.cfn.yaml",
      }),
    ).toThrow(/Refusing to continue/);
    expect(mutations).toEqual([]);
  });
});
