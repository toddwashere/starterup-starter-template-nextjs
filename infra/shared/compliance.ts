export type ComplianceMode = "none" | "hipaa" | "soc2" | "hipaa+soc2";

export interface ComplianceConfig {
  mode: ComplianceMode;
  auditLogs: boolean;
  immutableLogSink: boolean;
  logRetentionDays: number;
  cmek: boolean;
  orgPolicies: boolean;
  binaryAuthorization: boolean;
  cloudArmor: boolean;
  vpcServiceControls: boolean;
}

const HIPAA_RETENTION = 2190; // ~6 years
const SOC2_RETENTION = 365; // ~1 year

function baseRetention(mode: ComplianceMode): number {
  switch (mode) {
    case "none":
      return 0;
    case "soc2":
      return SOC2_RETENTION;
    case "hipaa":
      return HIPAA_RETENTION;
    case "hipaa+soc2":
      return Math.max(HIPAA_RETENTION, SOC2_RETENTION);
  }
}

export function resolveCompliance(
  mode: ComplianceMode,
  overrides: { logRetentionDays?: number; vpcServiceControls?: boolean } = {},
): ComplianceConfig {
  const enabled = mode !== "none";
  return {
    mode,
    auditLogs: enabled,
    immutableLogSink: enabled,
    logRetentionDays: overrides.logRetentionDays ?? baseRetention(mode),
    cmek: enabled,
    orgPolicies: enabled,
    binaryAuthorization: enabled,
    cloudArmor: enabled,
    vpcServiceControls: overrides.vpcServiceControls ?? false,
  };
}
