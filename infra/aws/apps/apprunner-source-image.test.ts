import { describe, expect, it } from "vitest";
import { withAppRunnerImageIdentifier } from "./apprunner-source-image";

const REGISTRY = "123456789012.dkr.ecr.us-east-2.amazonaws.com/platform";

/**
 * Shaped like `aws apprunner describe-service --query Service.SourceConfiguration`
 * (PascalCase wire keys, not the camelCase Pulumi input names).
 */
function describePayload() {
  return {
    ImageRepository: {
      ImageIdentifier: `${REGISTRY}/dashboard:oldsha`,
      ImageRepositoryType: "ECR",
      ImageConfiguration: {
        Port: "3000",
        RuntimeEnvironmentVariables: {
          BETTER_AUTH_URL: "https://dashboard-staging.example.com",
          WORKER_QUEUE_ADAPTER: "sqs",
        },
        RuntimeEnvironmentSecrets: {
          DATABASE_URL:
            "arn:aws:secretsmanager:us-east-2:123456789012:secret:/staging/database-url",
          STRIPE_SECRET_KEY:
            "arn:aws:secretsmanager:us-east-2:123456789012:secret:/staging/stripe-secret-key",
        },
      },
    },
    AutoDeploymentsEnabled: false,
    AuthenticationConfiguration: {
      AccessRoleArn: "arn:aws:iam::123456789012:role/apprunner-ecr-access-1a2b3c4",
    },
  };
}

describe("withAppRunnerImageIdentifier", () => {
  it("replaces only the image identifier", () => {
    const updated = withAppRunnerImageIdentifier(
      describePayload(),
      `${REGISTRY}/dashboard:newsha`,
    ) as ReturnType<typeof describePayload>;

    expect(updated.ImageRepository.ImageIdentifier).toBe(`${REGISTRY}/dashboard:newsha`);
    expect(updated.ImageRepository.ImageRepositoryType).toBe("ECR");
  });

  it("preserves runtime secrets, variables, port, and the access role", () => {
    const original = describePayload();
    const updated = withAppRunnerImageIdentifier(
      original,
      `${REGISTRY}/dashboard:newsha`,
    ) as ReturnType<typeof describePayload>;

    // UpdateService REPLACES the whole source configuration — dropping any of
    // these silently strips the service's env at the next deploy.
    expect(updated.ImageRepository.ImageConfiguration.RuntimeEnvironmentSecrets).toEqual(
      original.ImageRepository.ImageConfiguration.RuntimeEnvironmentSecrets,
    );
    expect(updated.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables).toEqual(
      original.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables,
    );
    expect(updated.ImageRepository.ImageConfiguration.Port).toBe("3000");
    expect(updated.AuthenticationConfiguration.AccessRoleArn).toBe(
      original.AuthenticationConfiguration.AccessRoleArn,
    );
    expect(updated.AutoDeploymentsEnabled).toBe(false);
  });

  it("does not mutate the describe payload it was given", () => {
    const original = describePayload();
    const snapshot = JSON.parse(JSON.stringify(original));
    withAppRunnerImageIdentifier(original, `${REGISTRY}/dashboard:newsha`);
    expect(original).toEqual(snapshot);
  });

  it("deep-clones so nested objects are not shared with the input", () => {
    const original = describePayload();
    const updated = withAppRunnerImageIdentifier(
      original,
      `${REGISTRY}/dashboard:newsha`,
    ) as ReturnType<typeof describePayload>;

    expect(updated.ImageRepository.ImageConfiguration).not.toBe(
      original.ImageRepository.ImageConfiguration,
    );
    expect(updated.AuthenticationConfiguration).not.toBe(original.AuthenticationConfiguration);
  });

  it("throws rather than emitting a partial source configuration", () => {
    // Failing loud beats sending App Runner a config missing ImageRepository,
    // which would be accepted as a source-type change.
    expect(() =>
      withAppRunnerImageIdentifier({ AutoDeploymentsEnabled: false }, "img:tag"),
    ).toThrow(/ImageRepository/);
    expect(() => withAppRunnerImageIdentifier(null, "img:tag")).toThrow(/source configuration/i);
    expect(() => withAppRunnerImageIdentifier(describePayload(), "")).toThrow(/image identifier/i);
  });
});
