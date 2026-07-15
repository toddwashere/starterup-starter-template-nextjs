/**
 * Parse and validate reusable AWS pooler DNS configuration.
 *
 * This module derives delegated zone names and PgBouncer hostnames from the
 * root domain, and validates CIDR allowlists for the public PgBouncer endpoint.
 *
 * All parsing is fail-closed: reject empty domains, protocol/path/trailing-dot,
 * `0.0.0.0/0`, IPv6, any prefix other than /32, and empty union of
 * app+developer CIDRs.
 */

export type PoolerCidrSource = "application" | "developer";

export interface AwsPoolerConfigInput {
  rootDomain: string;
  appEgressCidrs: string;
  developerCidrs: string;
}

export interface AwsPoolerConfig {
  rootDomain: string;
  zoneName: string;
  hostname: string;
  allowedCidrs: Array<{ cidr: string; source: PoolerCidrSource }>;
}

export type AwsPoolerDnsConfig = Omit<AwsPoolerConfig, "allowedCidrs">;

export function resolveAwsPoolerDns(
  env: "sandbox" | "staging" | "production",
  rootDomainInput: string,
): AwsPoolerDnsConfig {
  const rootDomain = validateRootDomain(rootDomainInput);
  const zoneName = `${env}.aws.${rootDomain}`;

  return {
    rootDomain,
    zoneName,
    hostname: `db.${zoneName}`,
  };
}

export function resolveAwsPoolerConfig(
  env: "sandbox" | "staging" | "production",
  input: AwsPoolerConfigInput,
): AwsPoolerConfig {
  const dns = resolveAwsPoolerDns(env, input.rootDomain);

  const appCidrs = parseCidrList(input.appEgressCidrs);
  const devCidrs = parseCidrList(input.developerCidrs);

  if (appCidrs.length === 0 && devCidrs.length === 0) {
    throw new Error("At least one CIDR must be provided in appEgressCidrs or developerCidrs");
  }

  const developerSet = new Set(devCidrs);
  const duplicateAcrossSources = appCidrs.find((cidr) => developerSet.has(cidr));
  if (duplicateAcrossSources) {
    throw new Error(
      `CIDR ${duplicateAcrossSources} must not appear in both application and developer allowlists`,
    );
  }

  const allowedCidrs = [
    ...appCidrs.map((cidr) => ({ cidr, source: "application" as PoolerCidrSource })),
    ...devCidrs.map((cidr) => ({ cidr, source: "developer" as PoolerCidrSource })),
  ];

  return {
    ...dns,
    allowedCidrs,
  };
}

function validateRootDomain(domain: string): string {
  const trimmed = domain.trim().toLowerCase();

  if (!trimmed) {
    throw new Error("Root domain is required");
  }

  if (trimmed.includes("://") || trimmed.includes("/")) {
    throw new Error("Root domain must not contain protocol or path");
  }

  if (trimmed.endsWith(".")) {
    throw new Error("Root domain must not have trailing dot");
  }

  const labels = trimmed.split(".");
  if (labels.length < 2) {
    throw new Error("Root domain must have at least two labels");
  }

  for (const label of labels) {
    if (!label) {
      throw new Error("Root domain must not have empty labels");
    }
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) {
      throw new Error("Root domain labels must be valid DNS labels");
    }
    if (label.length > 63) {
      throw new Error("Root domain labels must not exceed 63 characters");
    }
  }

  if (trimmed.length > 253) {
    throw new Error("Root domain must not exceed 253 characters");
  }

  return trimmed;
}

function parseCidrList(cidrs: string): string[] {
  const items = cidrs
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const validated = items.map(validateCidr);

  const seen = new Set<string>();
  const deduplicated: string[] = [];

  for (const cidr of validated) {
    if (!seen.has(cidr)) {
      seen.add(cidr);
      deduplicated.push(cidr);
    }
  }

  return deduplicated;
}

function validateCidr(cidr: string): string {
  if (cidr === "0.0.0.0/0") {
    throw new Error("CIDR 0.0.0.0/0 is not allowed");
  }

  if (cidr.includes(":")) {
    throw new Error("IPv6 CIDRs are not supported");
  }

  const parts = cidr.split("/");
  if (parts.length === 1) {
    throw new Error(`CIDR must include prefix length: ${cidr}`);
  }
  if (parts.length !== 2) {
    throw new Error(`Invalid CIDR format: ${cidr}`);
  }

  const [ipStr, prefixStr] = parts;
  if (prefixStr !== "32") {
    throw new Error(`Only individual IPv4 addresses with a /32 prefix are allowed: ${cidr}`);
  }

  const octets = ipStr.split(".");
  if (octets.length !== 4) {
    throw new Error(`Invalid IPv4 address: ${ipStr}`);
  }

  for (const octetStr of octets) {
    const octet = parseInt(octetStr, 10);
    if (isNaN(octet) || octet < 0 || octet > 255 || octetStr !== String(octet)) {
      throw new Error(`Invalid IPv4 octet: ${octetStr} in ${ipStr}`);
    }
  }

  return cidr;
}
