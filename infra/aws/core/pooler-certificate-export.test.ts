import { describe, test, expect } from "vitest";
import {
  exportPoolerCertificate,
  type PoolerCertificateExportEvent,
  type PoolerCertificateExportDependencies,
} from "./pooler-certificate-export";

describe("exportPoolerCertificate", () => {
  const validEvent: PoolerCertificateExportEvent = {
    mode: "initial",
    certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/test-id",
    secretId: "pooler-cert-secret",
    clusterName: "pooler-cluster",
    serviceName: "pooler-service",
  };

  const validExportedCert = {
    certificate: "-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----",
    certificateChain:
      "-----BEGIN CERTIFICATE-----\nMIID...\n-----END CERTIFICATE-----",
    privateKey:
      "-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIE...\n-----END ENCRYPTED PRIVATE KEY-----",
  };

  const decryptedPrivateKey =
    "-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----";

  test("export failure means zero secret writes and zero ECS calls", async () => {
    let secretWriteCount = 0;
    let ecsCallCount = 0;

    const deps: PoolerCertificateExportDependencies = {
      randomPassphrase: () => "test-passphrase-32-bytes-minimum",
      exportCertificate: async () => {
        throw new Error("ACM export failed");
      },
      decryptPrivateKey: () => {
        throw new Error("Should not be called");
      },
      putSecretValue: async () => {
        secretWriteCount++;
      },
      updateService: async () => {
        ecsCallCount++;
      },
    };

    await expect(exportPoolerCertificate(validEvent, deps)).rejects.toThrow(
      "ACM export failed",
    );

    expect(secretWriteCount).toBe(0);
    expect(ecsCallCount).toBe(0);
  });

  test("key-conversion failure means zero secret writes and zero ECS calls", async () => {
    let secretWriteCount = 0;
    let ecsCallCount = 0;

    const deps: PoolerCertificateExportDependencies = {
      randomPassphrase: () => "test-passphrase-32-bytes-minimum",
      exportCertificate: async () => validExportedCert,
      decryptPrivateKey: () => {
        throw new Error("Key conversion failed");
      },
      putSecretValue: async () => {
        secretWriteCount++;
      },
      updateService: async () => {
        ecsCallCount++;
      },
    };

    await expect(exportPoolerCertificate(validEvent, deps)).rejects.toThrow(
      "Key conversion failed",
    );

    expect(secretWriteCount).toBe(0);
    expect(ecsCallCount).toBe(0);
  });

  test("initial success writes valid JSON but does not call ECS", async () => {
    let writtenSecretId: string | undefined;
    let writtenSecretValue: string | undefined;
    let ecsCallCount = 0;

    const deps: PoolerCertificateExportDependencies = {
      randomPassphrase: () => "test-passphrase-32-bytes-minimum",
      exportCertificate: async () => validExportedCert,
      decryptPrivateKey: () => decryptedPrivateKey,
      putSecretValue: async (secretId, secretValue) => {
        writtenSecretId = secretId;
        writtenSecretValue = secretValue;
      },
      updateService: async () => {
        ecsCallCount++;
      },
    };

    const result = await exportPoolerCertificate(validEvent, deps);

    expect(writtenSecretId).toBe(validEvent.secretId);
    expect(writtenSecretValue).toBeDefined();

    const parsed = JSON.parse(writtenSecretValue!);
    expect(parsed.certificate).toBe(validExportedCert.certificate);
    expect(parsed.certificateChain).toBe(validExportedCert.certificateChain);
    expect(parsed.privateKey).toBe(decryptedPrivateKey);

    expect(ecsCallCount).toBe(0);

    expect(result).toEqual({ updated: true, deployed: false });
  });

  test("renewal success writes secret first, then calls ECS with forceNewDeployment", async () => {
    const callOrder: string[] = [];

    const deps: PoolerCertificateExportDependencies = {
      randomPassphrase: () => "test-passphrase-32-bytes-minimum",
      exportCertificate: async () => validExportedCert,
      decryptPrivateKey: () => decryptedPrivateKey,
      putSecretValue: async (secretId, secretValue) => {
        callOrder.push(`putSecret:${secretId}`);
      },
      updateService: async (clusterName, serviceName) => {
        callOrder.push(`updateService:${clusterName}:${serviceName}`);
      },
    };

    const renewalEvent: PoolerCertificateExportEvent = {
      ...validEvent,
      mode: "renewal",
    };

    const result = await exportPoolerCertificate(renewalEvent, deps);

    expect(callOrder).toEqual([
      `putSecret:${validEvent.secretId}`,
      `updateService:${validEvent.clusterName}:${validEvent.serviceName}`,
    ]);

    expect(result).toEqual({ updated: true, deployed: true });
  });

  test("returned value contains status metadata only and no secret material", async () => {
    const deps: PoolerCertificateExportDependencies = {
      randomPassphrase: () => "test-passphrase-32-bytes-minimum",
      exportCertificate: async () => validExportedCert,
      decryptPrivateKey: () => decryptedPrivateKey,
      putSecretValue: async () => {},
      updateService: async () => {},
    };

    const result = await exportPoolerCertificate(validEvent, deps);

    expect(result).toEqual({ updated: true, deployed: false });
    expect(result).not.toHaveProperty("certificate");
    expect(result).not.toHaveProperty("certificateChain");
    expect(result).not.toHaveProperty("privateKey");
    expect(result).not.toHaveProperty("passphrase");
  });
});
