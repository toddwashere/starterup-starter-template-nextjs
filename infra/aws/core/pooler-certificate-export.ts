import { ACMClient, ExportCertificateCommand } from "@aws-sdk/client-acm";
import { ECSClient, UpdateServiceCommand } from "@aws-sdk/client-ecs";
import { SecretsManagerClient, PutSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { createPrivateKey } from "node:crypto";
import { randomBytes } from "node:crypto";

export interface PoolerCertificateExportEvent {
  mode: "initial" | "renewal";
  certificateArn: string;
  secretId: string;
  clusterName: string;
  serviceName: string;
}

export interface PoolerCertificateExportDependencies {
  randomPassphrase: () => string;
  exportCertificate: (
    certificateArn: string,
    passphrase: string,
  ) => Promise<{
    certificate: string;
    certificateChain: string;
    privateKey: string;
  }>;
  decryptPrivateKey: (encryptedKey: string, passphrase: string) => string;
  putSecretValue: (secretId: string, secretValue: string) => Promise<void>;
  updateService: (clusterName: string, serviceName: string) => Promise<void>;
}

export async function exportPoolerCertificate(
  event: PoolerCertificateExportEvent,
  deps: PoolerCertificateExportDependencies,
): Promise<{ updated: true; deployed: boolean }> {
  const passphrase = deps.randomPassphrase();
  const exported = await deps.exportCertificate(event.certificateArn, passphrase);
  const privateKey = deps.decryptPrivateKey(exported.privateKey, passphrase);

  await deps.putSecretValue(
    event.secretId,
    JSON.stringify({
      certificate: exported.certificate,
      certificateChain: exported.certificateChain,
      privateKey,
    }),
  );

  if (event.mode === "renewal") {
    await deps.updateService(event.clusterName, event.serviceName);
  }

  return { updated: true, deployed: event.mode === "renewal" };
}

// Production adapter

function generateRandomPassphrase(): string {
  return randomBytes(32).toString("base64");
}

async function exportCertificateFromACM(
  certificateArn: string,
  passphrase: string,
): Promise<{
  certificate: string;
  certificateChain: string;
  privateKey: string;
}> {
  const acmClient = new ACMClient({});
  const command = new ExportCertificateCommand({
    CertificateArn: certificateArn,
    Passphrase: Buffer.from(passphrase, "utf-8"),
  });

  const response = await acmClient.send(command);

  if (!response.Certificate || !response.CertificateChain || !response.PrivateKey) {
    throw new Error("ACM export did not return complete certificate data");
  }

  return {
    certificate: response.Certificate,
    certificateChain: response.CertificateChain,
    privateKey: response.PrivateKey,
  };
}

function decryptAndConvertPrivateKey(encryptedPem: string, passphrase: string): string {
  const privateKeyObject = createPrivateKey({
    key: encryptedPem,
    format: "pem",
    passphrase: passphrase,
  });

  return privateKeyObject.export({
    type: "pkcs8",
    format: "pem",
  }) as string;
}

async function writeSecretValue(secretId: string, secretValue: string): Promise<void> {
  const secretsClient = new SecretsManagerClient({});
  const command = new PutSecretValueCommand({
    SecretId: secretId,
    SecretString: secretValue,
  });

  await secretsClient.send(command);
}

async function forceServiceDeployment(clusterName: string, serviceName: string): Promise<void> {
  const ecsClient = new ECSClient({});
  const command = new UpdateServiceCommand({
    cluster: clusterName,
    service: serviceName,
    forceNewDeployment: true,
  });

  await ecsClient.send(command);
}

export async function handler(
  event: PoolerCertificateExportEvent,
): Promise<{ updated: true; deployed: boolean }> {
  return exportPoolerCertificate(event, {
    randomPassphrase: generateRandomPassphrase,
    exportCertificate: exportCertificateFromACM,
    decryptPrivateKey: decryptAndConvertPrivateKey,
    putSecretValue: writeSecretValue,
    updateService: forceServiceDeployment,
  });
}
