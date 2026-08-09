/**
 * `aws apprunner update-service --source-configuration` REPLACES the service's
 * entire source configuration; it does not merge. Sending a hand-built payload
 * that carries only the new image silently wipes `RuntimeEnvironmentSecrets`,
 * `RuntimeEnvironmentVariables`, the port, and the ECR access role.
 *
 * The release workflow therefore does describe → merge → update, and this is
 * the unit-tested definition of that merge: swap exactly one field, deep-clone
 * everything else through untouched.
 *
 * Keys here are the AWS wire format (PascalCase) returned by
 * `describe-service --query Service.SourceConfiguration`, NOT Pulumi's
 * camelCase input names.
 */
export function withAppRunnerImageIdentifier(
  sourceConfiguration: unknown,
  imageIdentifier: string,
): unknown {
  if (
    sourceConfiguration === null ||
    typeof sourceConfiguration !== "object" ||
    Array.isArray(sourceConfiguration)
  ) {
    throw new Error(
      "App Runner source configuration must be an object (from describe-service --query Service.SourceConfiguration).",
    );
  }
  if (!imageIdentifier) {
    throw new Error("App Runner image identifier must be a non-empty string.");
  }

  const clone = structuredClone(sourceConfiguration) as Record<string, unknown>;
  const imageRepository = clone.ImageRepository;

  if (
    imageRepository === null ||
    typeof imageRepository !== "object" ||
    Array.isArray(imageRepository)
  ) {
    throw new Error(
      "App Runner source configuration has no ImageRepository — refusing to build a partial update.",
    );
  }

  (imageRepository as Record<string, unknown>).ImageIdentifier = imageIdentifier;
  return clone;
}
