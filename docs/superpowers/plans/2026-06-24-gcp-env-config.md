# GCP Environment Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship committable, secret-free GCP environment profiles at `infra/gcp/config.<env>.yaml` with a `pnpm infra:configure` command that validates tiered rules, merges new defaults on rerun, and fans out to all six Pulumi stack config files — making sandbox deploy turnkey without Pulumi Cloud / ESC.

**Architecture:** Pure logic lives in `infra/shared/gcp-env-config.ts` (merge, validate, fan-out mapping) with colocated Vitest tests. The impure CLI `infra/scripts/configure.ts` reads/writes YAML via the `yaml` package, calls pure helpers, and atomically writes layer `Pulumi.<env>.yaml` files. `infra/scripts/infra.ts` invokes configure at the start of `init` and prints post-deploy placeholder-secret guidance after `deploy`. Layer Pulumi programs are unchanged.

**Tech Stack:** TypeScript ^5.7, `tsx` ^4, Vitest ^3, Zod ^3 (already in root devDependencies), `yaml` ^2 (new devDependency), existing orchestrator (`infra/scripts/orchestration.ts`).

**Design spec:** [`docs/superpowers/specs/2026-06-24-gcp-env-config-design.md`](../specs/2026-06-24-gcp-env-config-design.md)

## Global Constraints

- Env names are exactly `sandbox | staging | production` (match `--env` and Pulumi stack names).
- Config files live at `infra/gcp/config.<env>.yaml`; example templates at `infra/gcp/config.<env>.example.yaml`.
- **No secret values** in env config — placeholders populated via gcloud after deploy.
- Self-managed GCS Pulumi backend — **no Pulumi ESC**.
- StackReference paths use `organization/starter-gcp-<layer>/<env>` (from `stackRefPath()` in `orchestration.ts`).
- `complianceMode` enum: `none | hipaa | soc2 | hipaa+soc2` — single top-level value propagated to every layer.
- Configure merge: fill missing keys from example defaults only; **never overwrite** keys the developer set.
- ESM only — `import`/`export`, no `require()`.
- Colocated tests — no `__tests__/` folders.

---

## File Structure

- Create: `infra/shared/gcp-env-config.ts` — types, merge, validate, fan-out (pure, no I/O).
- Create: `infra/shared/gcp-env-config.test.ts` — Critical Tests.
- Create: `infra/scripts/configure.ts` — CLI (YAML I/O, atomic writes).
- Create: `infra/scripts/configure.test.ts` — YAML serialize golden tests.
- Create: `infra/gcp/config.sandbox.example.yaml` — committed template with sandbox defaults.
- Create: `infra/gcp/config.staging.example.yaml`
- Create: `infra/gcp/config.production.example.yaml`
- Create: `infra/gcp/config.sandbox.yaml` — committed starter (`your-sandbox-project-id` placeholder).
- Create: `infra/gcp/config.staging.yaml`
- Create: `infra/gcp/config.production.yaml`
- Modify: `infra/scripts/infra.ts` — call configure from `init`; post-deploy placeholder checklist.
- Modify: `package.json` (root) — add `infra:configure`, `yaml` devDependency.
- Modify: `infra/gcp/README.md` — lead with env config workflow.
- Modify: `infra/README.md` — quick-start points to configure first.

## Critical Tests

- `infra/shared/gcp-env-config.test.ts`:
  - **Merge** — `mergeEnvConfig(user, defaults)` fills missing nested keys; never overwrites user-set values.
  - **Validation critical** — missing `gcp.project` → `ok: false`; `enableHttpsLb: true` without `lbDomain` → critical error.
  - **Validation recommended** — empty `githubRepo` → warning only, `ok: true`.
  - **Fan-out bootstrap** — produces `gcp:project`, `starter-gcp-bootstrap:complianceMode`, omits empty optional keys.
  - **Fan-out stack refs** — database layer gets `starter-gcp-database:bootstrapStackRef: organization/starter-gcp-bootstrap/sandbox`.
  - **Compliance propagation** — top-level `complianceMode: soc2` appears on all six layer outputs.
  - **Schema version** — unsupported `schemaVersion: 99` fails validation.
- `infra/scripts/configure.test.ts`:
  - **`renderLayerYaml`** — golden string for bootstrap layer matches expected `config:` block (header comment + keys).

---

## Chunk 1: Pure env-config module

### Task 1: Types, merge, and defaults loader

**Files:**
- Create: `infra/shared/gcp-env-config.ts`
- Create: `infra/shared/gcp-env-config.test.ts`

**Interfaces:**
- Produces: `export type GcpEnvName = "sandbox" | "staging" | "production"`
- Produces: `export interface GcpEnvConfig { schemaVersion: number; gcp: { project: string; region: string }; complianceMode: ComplianceMode; bootstrap: BootstrapConfig; database: DatabaseConfig; storage: StorageConfig; messaging: MessagingConfig; apps: AppsConfig }`
- Produces: `export function mergeEnvConfig(user: Partial<GcpEnvConfig>, defaults: GcpEnvConfig): GcpEnvConfig`
- Produces: `export function envConfigPath(env: GcpEnvName): string` → `infra/gcp/config.${env}.yaml`
- Produces: `export function envExamplePath(env: GcpEnvName): string` → `infra/gcp/config.${env}.example.yaml`

- [ ] **Step 1: Write failing merge tests**

Add to `infra/shared/gcp-env-config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mergeEnvConfig, type GcpEnvConfig } from "./gcp-env-config";

const DEFAULTS: GcpEnvConfig = {
  schemaVersion: 1,
  gcp: { project: "default-proj", region: "us-central1" },
  complianceMode: "none",
  bootstrap: { privateNetwork: false, vpcCidr: "10.10.0.0/24", budgetAmount: 50, billingAccountId: "", githubRepo: "", securityContactEmail: "" },
  database: { tier: "db-f1-micro", version: "POSTGRES_16", availability: "ZONAL", pointInTimeRecovery: false },
  storage: { forceDestroy: false },
  messaging: { enableRedis: false, redisTier: "BASIC", redisMemorySizeGb: 1 },
  apps: { imageTag: "latest", enableHttpsLb: false, enableMonitoring: false, lbDomain: "", alertEmail: "", vpcServiceControls: false, accessPolicyId: "" },
};

describe("mergeEnvConfig", () => {
  it("fills missing keys from defaults without overwriting user values", () => {
    const merged = mergeEnvConfig(
      { gcp: { project: "my-proj", region: "us-central1" } },
      DEFAULTS,
    );
    expect(merged.gcp.project).toBe("my-proj");
    expect(merged.database.tier).toBe("db-f1-micro");
    expect(merged.bootstrap.budgetAmount).toBe(50);
  });

  it("preserves user-set nested values", () => {
    const merged = mergeEnvConfig(
      { database: { tier: "db-custom-2-7680", version: "POSTGRES_16", availability: "REGIONAL", pointInTimeRecovery: true } },
      DEFAULTS,
    );
    expect(merged.database.tier).toBe("db-custom-2-7680");
    expect(merged.database.pointInTimeRecovery).toBe(true);
    expect(merged.gcp.project).toBe("default-proj");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:scripts infra/shared/gcp-env-config.test.ts`
Expected: FAIL — cannot find `./gcp-env-config`

- [ ] **Step 3: Implement merge + types**

Create `infra/shared/gcp-env-config.ts`:

```ts
import type { ComplianceMode } from "./compliance";

export type GcpEnvName = "sandbox" | "staging" | "production";

export const GCP_ENV_NAMES: readonly GcpEnvName[] = ["sandbox", "staging", "production"];
export const SUPPORTED_SCHEMA_VERSION = 1;

export interface BootstrapConfig {
  privateNetwork: boolean;
  vpcCidr: string;
  budgetAmount: number;
  billingAccountId: string;
  githubRepo: string;
  securityContactEmail: string;
}

export interface DatabaseConfig {
  tier: string;
  version: string;
  availability: string;
  pointInTimeRecovery: boolean;
}

export interface StorageConfig {
  forceDestroy: boolean;
}

export interface MessagingConfig {
  enableRedis: boolean;
  redisTier: string;
  redisMemorySizeGb: number;
}

export interface AppsConfig {
  imageTag: string;
  enableHttpsLb: boolean;
  enableMonitoring: boolean;
  lbDomain: string;
  alertEmail: string;
  vpcServiceControls: boolean;
  accessPolicyId: string;
}

export interface GcpEnvConfig {
  schemaVersion: number;
  gcp: { project: string; region: string };
  complianceMode: ComplianceMode;
  bootstrap: BootstrapConfig;
  database: DatabaseConfig;
  storage: StorageConfig;
  messaging: MessagingConfig;
  apps: AppsConfig;
}

export function envConfigPath(env: GcpEnvName): string {
  return `infra/gcp/config.${env}.yaml`;
}

export function envExamplePath(env: GcpEnvName): string {
  return `infra/gcp/config.${env}.example.yaml`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep-merge: fill missing keys from defaults; never overwrite user-provided values. */
export function mergeEnvConfig(
  user: Partial<GcpEnvConfig>,
  defaults: GcpEnvConfig,
): GcpEnvConfig {
  const out = structuredClone(defaults);
  for (const [key, value] of Object.entries(user)) {
    if (value === undefined) continue;
    const k = key as keyof GcpEnvConfig;
    if (isPlainObject(value) && isPlainObject(out[k])) {
      (out as Record<string, unknown>)[key] = mergeEnvConfig(
        value as Partial<GcpEnvConfig>,
        out[k] as GcpEnvConfig,
      );
    } else {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test:scripts infra/shared/gcp-env-config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infra/shared/gcp-env-config.ts infra/shared/gcp-env-config.test.ts
git commit -m "feat(infra): add gcp env config types and merge helper"
```

---

### Task 2: Validation tiers

**Files:**
- Modify: `infra/shared/gcp-env-config.ts`
- Modify: `infra/shared/gcp-env-config.test.ts`

**Interfaces:**
- Produces: `export interface ValidateResult { ok: boolean; critical: string[]; warnings: string[] }`
- Produces: `export function validateEnvConfig(config: GcpEnvConfig, env: GcpEnvName): ValidateResult`

- [ ] **Step 1: Write failing validation tests**

Append to `infra/shared/gcp-env-config.test.ts`:

```ts
import { validateEnvConfig } from "./gcp-env-config";

describe("validateEnvConfig", () => {
  it("fails critical when gcp.project is empty", () => {
    const cfg = mergeEnvConfig({ gcp: { project: "", region: "us-central1" } }, DEFAULTS);
    const result = validateEnvConfig(cfg, "sandbox");
    expect(result.ok).toBe(false);
    expect(result.critical.some((e) => e.includes("gcp.project"))).toBe(true);
  });

  it("fails critical when enableHttpsLb is true without lbDomain", () => {
    const cfg = mergeEnvConfig(
      { apps: { ...DEFAULTS.apps, enableHttpsLb: true, lbDomain: "" } },
      DEFAULTS,
    );
    const result = validateEnvConfig(cfg, "production");
    expect(result.ok).toBe(false);
    expect(result.critical.some((e) => e.includes("lbDomain"))).toBe(true);
  });

  it("warns but passes when githubRepo is empty", () => {
    const cfg = mergeEnvConfig({ gcp: { project: "acme", region: "us-central1" } }, DEFAULTS);
    const result = validateEnvConfig(cfg, "sandbox");
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes("githubRepo"))).toBe(true);
  });

  it("fails on unsupported schemaVersion", () => {
    const cfg = mergeEnvConfig({ schemaVersion: 99, gcp: { project: "acme", region: "us-central1" } }, DEFAULTS);
    const result = validateEnvConfig(cfg, "sandbox");
    expect(result.ok).toBe(false);
    expect(result.critical.some((e) => e.includes("schemaVersion"))).toBe(true);
  });

  it("warns on sandbox cost guardrails when enableHttpsLb is true", () => {
    const cfg = mergeEnvConfig(
      {
        gcp: { project: "acme", region: "us-central1" },
        apps: { ...DEFAULTS.apps, enableHttpsLb: true, lbDomain: "example.com" },
      },
      DEFAULTS,
    );
    const result = validateEnvConfig(cfg, "sandbox");
    expect(result.warnings.some((w) => w.toLowerCase().includes("sandbox"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm test:scripts infra/shared/gcp-env-config.test.ts`

- [ ] **Step 3: Implement validateEnvConfig**

Append to `infra/shared/gcp-env-config.ts`:

```ts
const COMPLIANCE_MODES: readonly ComplianceMode[] = ["none", "hipaa", "soc2", "hipaa+soc2"];

export interface ValidateResult {
  ok: boolean;
  critical: string[];
  warnings: string[];
}

export function validateEnvConfig(config: GcpEnvConfig, env: GcpEnvName): ValidateResult {
  const critical: string[] = [];
  const warnings: string[] = [];

  if (config.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    critical.push(
      `Unsupported schemaVersion ${config.schemaVersion}; expected ${SUPPORTED_SCHEMA_VERSION}. Run the latest configure after upgrading the repo.`,
    );
  }

  if (!config.gcp.project?.trim()) {
    critical.push("Missing required gcp.project.");
  }
  if (!config.gcp.region?.trim()) {
    critical.push("Missing required gcp.region.");
  }

  if (!COMPLIANCE_MODES.includes(config.complianceMode)) {
    critical.push(`Invalid complianceMode "${config.complianceMode}".`);
  }

  if (config.apps.enableHttpsLb && !config.apps.lbDomain?.trim()) {
    critical.push("apps.enableHttpsLb is true but apps.lbDomain is empty.");
  }

  if (config.apps.enableMonitoring && !config.apps.alertEmail?.trim()) {
    critical.push("apps.enableMonitoring is true but apps.alertEmail is empty.");
  }

  if (config.bootstrap.budgetAmount > 0 && !config.bootstrap.billingAccountId?.trim()) {
    warnings.push("bootstrap.budgetAmount is set but billingAccountId is empty — budget resource will not be created.");
  }

  if (!config.bootstrap.githubRepo?.trim()) {
    warnings.push("bootstrap.githubRepo is empty — GitHub Actions WIF will not bind to a repo.");
  }

  if (config.complianceMode !== "none" && !config.bootstrap.securityContactEmail?.trim()) {
    warnings.push("complianceMode is enabled but bootstrap.securityContactEmail is empty.");
  }

  if (env === "sandbox" && config.apps.enableHttpsLb) {
    warnings.push("Sandbox has apps.enableHttpsLb enabled — this adds always-on LB cost.");
  }

  if (env === "sandbox" && config.database.tier !== "db-f1-micro") {
    warnings.push(`Sandbox uses database.tier "${config.database.tier}" — consider db-f1-micro for cost caps.`);
  }

  return { ok: critical.length === 0, critical, warnings };
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm test:scripts infra/shared/gcp-env-config.test.ts`

- [ ] **Step 5: Commit**

```bash
git add infra/shared/gcp-env-config.ts infra/shared/gcp-env-config.test.ts
git commit -m "feat(infra): add tiered gcp env config validation"
```

---

### Task 3: Fan-out to layer Pulumi config

**Files:**
- Modify: `infra/shared/gcp-env-config.ts`
- Modify: `infra/shared/gcp-env-config.test.ts`

**Interfaces:**
- Consumes: `Layer`, `stackRefPath` from `infra/scripts/orchestration.ts` — import types only; duplicate `stackRefPath` logic inline in shared module to avoid circular deps, OR export a shared `stackRefPath` from a new tiny module. **Chosen:** re-implement `stackRefPath` as a one-liner in `gcp-env-config.ts` (same formula: `` `organization/starter-gcp-${layer}/${env}` ``) to keep `infra/shared` free of `infra/scripts` imports.
- Produces: `export type LayerName = "bootstrap" | "database" | "storage" | "messaging" | "secrets" | "apps"`
- Produces: `export function fanOutLayerConfig(layer: LayerName, env: GcpEnvName, config: GcpEnvConfig): Record<string, string>`
- Produces: `export function renderPulumiStackYaml(configEntries: Record<string, string>): string`

- [ ] **Step 1: Write failing fan-out tests**

Append to `infra/shared/gcp-env-config.test.ts`:

```ts
import { fanOutLayerConfig, renderPulumiStackYaml } from "./gcp-env-config";

describe("fanOutLayerConfig", () => {
  const cfg = mergeEnvConfig(
    { gcp: { project: "acme-sandbox", region: "us-central1" }, complianceMode: "none" },
    DEFAULTS,
  );

  it("maps bootstrap keys", () => {
    const out = fanOutLayerConfig("bootstrap", "sandbox", cfg);
    expect(out["gcp:project"]).toBe("acme-sandbox");
    expect(out["starter-gcp-bootstrap:privateNetwork"]).toBe("false");
    expect(out["starter-gcp-bootstrap:complianceMode"]).toBe("none");
  });

  it("maps database stack ref", () => {
    const out = fanOutLayerConfig("database", "sandbox", cfg);
    expect(out["starter-gcp-database:bootstrapStackRef"]).toBe(
      "organization/starter-gcp-bootstrap/sandbox",
    );
    expect(out["starter-gcp-database:dbTier"]).toBe("db-f1-micro");
  });

  it("propagates complianceMode to apps layer", () => {
    const prod = mergeEnvConfig(
      { gcp: { project: "acme-prod", region: "us-central1" }, complianceMode: "soc2" },
      DEFAULTS,
    );
    const out = fanOutLayerConfig("apps", "production", prod);
    expect(out["starter-gcp-apps:complianceMode"]).toBe("soc2");
    expect(out["starter-gcp-apps:secretsStackRef"]).toBe(
      "organization/starter-gcp-secrets/production",
    );
  });

  it("omits empty optional bootstrap strings", () => {
    const out = fanOutLayerConfig("bootstrap", "sandbox", cfg);
    expect(out["starter-gcp-bootstrap:billingAccountId"]).toBeUndefined();
    expect(out["starter-gcp-bootstrap:githubRepo"]).toBeUndefined();
  });
});

describe("renderPulumiStackYaml", () => {
  it("renders a config block with quoted values", () => {
    const yaml = renderPulumiStackYaml({ "gcp:project": "acme", "gcp:region": "us-central1" });
    expect(yaml).toContain('gcp:project: "acme"');
    expect(yaml).toContain("config:");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement fan-out**

Append to `infra/shared/gcp-env-config.ts`:

```ts
export type LayerName = "bootstrap" | "database" | "storage" | "messaging" | "secrets" | "apps";

const LAYER_PREFIX: Record<LayerName, string> = {
  bootstrap: "starter-gcp-bootstrap",
  database: "starter-gcp-database",
  storage: "starter-gcp-storage",
  messaging: "starter-gcp-messaging",
  secrets: "starter-gcp-secrets",
  apps: "starter-gcp-apps",
};

function stackRef(layer: LayerName, env: GcpEnvName): string {
  return `organization/starter-gcp-${layer}/${env}`;
}

function setIfNonEmpty(target: Record<string, string>, key: string, value: string | undefined): void {
  if (value !== undefined && value !== "") {
    target[key] = value;
  }
}

export function fanOutLayerConfig(
  layer: LayerName,
  env: GcpEnvName,
  config: GcpEnvConfig,
): Record<string, string> {
  const p = LAYER_PREFIX[layer];
  const out: Record<string, string> = {
    "gcp:project": config.gcp.project,
    "gcp:region": config.gcp.region,
  };

  switch (layer) {
    case "bootstrap":
      out[`${p}:privateNetwork`] = String(config.bootstrap.privateNetwork);
      out[`${p}:vpcCidr`] = config.bootstrap.vpcCidr;
      out[`${p}:complianceMode`] = config.complianceMode;
      out[`${p}:budgetAmount`] = String(config.bootstrap.budgetAmount);
      setIfNonEmpty(out, `${p}:billingAccountId`, config.bootstrap.billingAccountId);
      setIfNonEmpty(out, `${p}:githubRepo`, config.bootstrap.githubRepo);
      setIfNonEmpty(out, `${p}:securityContactEmail`, config.bootstrap.securityContactEmail);
      break;
    case "database":
      out[`${p}:bootstrapStackRef`] = stackRef("bootstrap", env);
      out[`${p}:dbTier`] = config.database.tier;
      out[`${p}:dbVersion`] = config.database.version;
      out[`${p}:dbAvailability`] = config.database.availability;
      out[`${p}:dbPointInTime`] = String(config.database.pointInTimeRecovery);
      out[`${p}:complianceMode`] = config.complianceMode;
      break;
    case "storage":
      out[`${p}:bootstrapStackRef`] = stackRef("bootstrap", env);
      out[`${p}:forceDestroy`] = String(config.storage.forceDestroy);
      out[`${p}:complianceMode`] = config.complianceMode;
      break;
    case "messaging":
      out[`${p}:bootstrapStackRef`] = stackRef("bootstrap", env);
      out[`${p}:enableRedis`] = String(config.messaging.enableRedis);
      out[`${p}:redisTier`] = config.messaging.redisTier;
      out[`${p}:redisMemorySizeGb`] = String(config.messaging.redisMemorySizeGb);
      out[`${p}:complianceMode`] = config.complianceMode;
      break;
    case "secrets":
      out[`${p}:bootstrapStackRef`] = stackRef("bootstrap", env);
      out[`${p}:databaseStackRef`] = stackRef("database", env);
      break;
    case "apps":
      out[`${p}:bootstrapStackRef`] = stackRef("bootstrap", env);
      out[`${p}:databaseStackRef`] = stackRef("database", env);
      out[`${p}:storageStackRef`] = stackRef("storage", env);
      out[`${p}:messagingStackRef`] = stackRef("messaging", env);
      out[`${p}:secretsStackRef`] = stackRef("secrets", env);
      out[`${p}:imageTag`] = config.apps.imageTag;
      out[`${p}:enableHttpsLb`] = String(config.apps.enableHttpsLb);
      out[`${p}:enableMonitoring`] = String(config.apps.enableMonitoring);
      out[`${p}:complianceMode`] = config.complianceMode;
      setIfNonEmpty(out, `${p}:lbDomain`, config.apps.lbDomain);
      setIfNonEmpty(out, `${p}:alertEmail`, config.apps.alertEmail);
      if (config.apps.vpcServiceControls) {
        out[`${p}:vpcServiceControls`] = "true";
      }
      setIfNonEmpty(out, `${p}:accessPolicyId`, config.apps.accessPolicyId);
      break;
  }

  return out;
}

export function renderPulumiStackYaml(entries: Record<string, string>): string {
  const lines = [
    "# Generated by pnpm infra:configure — edit infra/gcp/config.<env>.yaml instead.",
    "config:",
  ];
  for (const [key, value] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${key}: "${value.replace(/"/g, '\\"')}"`);
  }
  return `${lines.join("\n")}\n`;
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm test:scripts infra/shared/gcp-env-config.test.ts`

- [ ] **Step 5: Commit**

```bash
git add infra/shared/gcp-env-config.ts infra/shared/gcp-env-config.test.ts
git commit -m "feat(infra): fan out gcp env config to pulumi layer keys"
```

---

## Chunk 2: Example YAML templates + configure CLI

### Task 4: Committed example and starter config files

**Files:**
- Create: `infra/gcp/config.sandbox.example.yaml`
- Create: `infra/gcp/config.staging.example.yaml`
- Create: `infra/gcp/config.production.example.yaml`
- Create: `infra/gcp/config.sandbox.yaml`
- Create: `infra/gcp/config.staging.yaml`
- Create: `infra/gcp/config.production.yaml`

- [ ] **Step 1: Create sandbox example** (`infra/gcp/config.sandbox.example.yaml`)

```yaml
schemaVersion: 1

gcp:
  project: "your-sandbox-project-id"
  region: "us-central1"

complianceMode: "none"

bootstrap:
  privateNetwork: false
  vpcCidr: "10.10.0.0/24"
  budgetAmount: 50
  billingAccountId: ""
  githubRepo: ""
  securityContactEmail: ""

database:
  tier: "db-f1-micro"
  version: "POSTGRES_16"
  availability: "ZONAL"
  pointInTimeRecovery: false

storage:
  forceDestroy: true

messaging:
  enableRedis: false
  redisTier: "BASIC"
  redisMemorySizeGb: 1

apps:
  imageTag: "latest"
  enableHttpsLb: false
  enableMonitoring: false
  lbDomain: ""
  alertEmail: ""
  vpcServiceControls: false
  accessPolicyId: ""
```

- [ ] **Step 2: Create staging example** — same shape; set `privateNetwork: true`, `database.tier: "db-custom-2-7680"`, `database.availability: "REGIONAL"`, `storage.forceDestroy: false`, `apps.enableMonitoring: true`.

- [ ] **Step 3: Create production example** — staging defaults plus `complianceMode: "soc2"`, `database.pointInTimeRecovery: true`, `apps.enableHttpsLb: true`, `apps.lbDomain: "example.com"`, `apps.enableMonitoring: true`, `apps.alertEmail: "alerts@example.com"`, `bootstrap.budgetAmount: 150`.

- [ ] **Step 4: Copy each example to `config.<env>.yaml`** (same content initially — committed placeholders).

- [ ] **Step 5: Commit**

```bash
git add infra/gcp/config.*.yaml
git commit -m "feat(infra): add gcp env config templates for all environments"
```

---

### Task 5: Configure CLI

**Files:**
- Modify: `package.json` — add `"infra:configure": "tsx infra/scripts/configure.ts"` and `"yaml": "^2.7.0"` to devDependencies (run `pnpm add -D yaml` from repo root).
- Create: `infra/scripts/configure.ts`

**Interfaces:**
- Consumes: all exports from `infra/shared/gcp-env-config.ts`
- Consumes: `placeholderSecrets`, `SECRET_CATALOG` from `infra/shared/secret-catalog.ts` for post-run checklist
- Consumes: `GCP_ENV_NAMES`, `isEnv` pattern from `orchestration.ts` for arg parsing

- [ ] **Step 1: Add yaml dependency**

Run from repo root: `pnpm add -D yaml`

- [ ] **Step 2: Create configure CLI**

Create `infra/scripts/configure.ts`:

```ts
#!/usr/bin/env tsx
import { readFileSync, writeFileSync, renameSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

import { placeholderSecrets } from "../shared/secret-catalog";
import {
  GCP_ENV_NAMES,
  envConfigPath,
  envExamplePath,
  fanOutLayerConfig,
  mergeEnvConfig,
  renderPulumiStackYaml,
  validateEnvConfig,
  type GcpEnvConfig,
  type GcpEnvName,
  type LayerName,
} from "../shared/gcp-env-config";

const LAYERS: LayerName[] = [
  "bootstrap",
  "database",
  "storage",
  "messaging",
  "secrets",
  "apps",
];

function parseEnvArg(argv: string[]): GcpEnvName {
  let env: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--env" || argv[i] === "-e") env = argv[++i];
    if (argv[i]?.startsWith("--env=")) env = argv[i]!.slice("--env=".length);
  }
  if (!env) return "sandbox";
  if (!(GCP_ENV_NAMES as readonly string[]).includes(env)) {
    throw new Error(`Invalid --env "${env}". Expected: ${GCP_ENV_NAMES.join("|")}`);
  }
  return env as GcpEnvName;
}

function loadYamlFile(path: string): Partial<GcpEnvConfig> {
  return parseYaml(readFileSync(path, "utf8")) as Partial<GcpEnvConfig>;
}

function atomicWrite(path: string, content: string): void {
  const dir = mkdtempSync(join(tmpdir(), "pulumi-config-"));
  const tmp = join(dir, "Pulumi.tmp.yaml");
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

function layerPulumiPath(layer: LayerName, env: GcpEnvName): string {
  return join("infra", "gcp", layer, `Pulumi.${env}.yaml`);
}

function printPlaceholderChecklist(): void {
  console.log("\nPlaceholder secrets (populate after deploy via gcloud — never in config files):");
  for (const s of placeholderSecrets()) {
    console.log(`  • ${s.id} → env ${s.envVar} (readers: ${s.readers.join(", ")})`);
  }
}

function main(): void {
  const env = parseEnvArg(process.argv.slice(2));
  const configFile = envConfigPath(env);
  const exampleFile = envExamplePath(env);

  const defaults = loadYamlFile(exampleFile) as GcpEnvConfig;
  let user: Partial<GcpEnvConfig> = {};
  try {
    user = loadYamlFile(configFile);
  } catch {
    throw new Error(`Missing ${configFile}. Copy ${exampleFile} and set gcp.project.`);
  }

  const merged = mergeEnvConfig(user, defaults);
  const validation = validateEnvConfig(merged, env);

  for (const w of validation.warnings) console.warn(`⚠ ${w}`);
  if (!validation.ok) {
    console.error("✖ Configure failed:");
    for (const e of validation.critical) console.error(`  - ${e}`);
    process.exit(1);
  }

  for (const layer of LAYERS) {
    const entries = fanOutLayerConfig(layer, env, merged);
    const yaml = renderPulumiStackYaml(entries);
    atomicWrite(layerPulumiPath(layer, env), yaml);
    console.log(`✓ Wrote ${layerPulumiPath(layer, env)}`);
  }

  printPlaceholderChecklist();
  console.log(`\nNext: pnpm infra:init --env ${env} && pnpm infra:deploy --env ${env}`);
}

main();
```

- [ ] **Step 3: Add script to package.json**

```json
"infra:configure": "tsx infra/scripts/configure.ts"
```

- [ ] **Step 4: Run configure on sandbox**

Run: `pnpm infra:configure --env sandbox`
Expected: writes six `Pulumi.sandbox.yaml` files; exit 0 with warnings about githubRepo.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml infra/scripts/configure.ts infra/gcp/*/Pulumi.*.yaml
git commit -m "feat(infra): add infra:configure CLI with yaml fan-out"
```

---

## Chunk 3: Orchestrator integration + docs

### Task 6: Wire configure into init and deploy checklist

**Files:**
- Modify: `infra/scripts/infra.ts`

- [ ] **Step 1: Import and call configure at start of cmdInit**

At top of `infra/scripts/infra.ts`, add a helper that shells out to configure (keeps I/O in infra.ts, reuses CLI):

```ts
function runConfigure(env: Env): void {
  console.log(`\n▶ Running configure for env "${env}" …`);
  sh("pnpm", ["infra:configure", "--env", env]);
}
```

In `cmdInit`, before `getProjectId`:

```ts
function cmdInit(env: Env): void {
  runConfigure(env);
  const projectId = getProjectId(env);
  // … rest unchanged
}
```

- [ ] **Step 2: Add post-deploy placeholder reminder in cmdDeploy**

After successful deploy loop in `cmdDeploy`, import `placeholderSecrets` and print:

```ts
import { placeholderSecrets } from "../shared/secret-catalog";

function printSecretReminder(): void {
  console.log("\n▶ Placeholder secrets (populate when ready — apps may stay unhealthy until set):");
  for (const s of placeholderSecrets()) {
    console.log(`  gcloud secrets versions add ${s.id} --data-file=- --project <project>`);
  }
}
```

Call `printSecretReminder()` before `"✓ Deploy complete."`.

- [ ] **Step 3: Run tests**

Run: `pnpm test:scripts`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add infra/scripts/infra.ts
git commit -m "feat(infra): run configure on init and print secret checklist after deploy"
```

---

### Task 7: Update READMEs

**Files:**
- Modify: `infra/gcp/README.md`
- Modify: `infra/README.md`

- [ ] **Step 1: Replace TL;DR in `infra/gcp/README.md`** with:

```markdown
## TL;DR — deploy a sandbox in 4 steps

```bash
# 0. One-time machine setup
gcloud auth application-default login
gcloud projects create my-sandbox-proj   # link billing in console

# 1. Set project in infra/gcp/config.sandbox.yaml (copy from config.sandbox.example.yaml)

# 2. Validate + fan out config to all Pulumi layers
pnpm infra:configure --env sandbox

# 3. State bucket + stack init
pnpm infra:init --env sandbox

# 4. Deploy all six layers
pnpm infra:deploy --env sandbox
```

Env profiles live at `infra/gcp/config.<env>.yaml` — secret-free and safe to commit.
Re-run `pnpm infra:configure --env <env>` after pulling infra changes to merge new defaults.
```

- [ ] **Step 2: Update `infra/README.md` Quick start** — add configure step before init.

- [ ] **Step 3: Commit**

```bash
git add infra/gcp/README.md infra/README.md
git commit -m "docs(infra): document gcp env config workflow"
```

---

## Chunk 4: Verification

### Task 8: Full verification pass

- [ ] **Step 1: Run unit tests**

Run: `pnpm test:scripts`
Expected: all pass

- [ ] **Step 2: Run lint and type-check**

Run: `pnpm lint && pnpm type-check`
Expected: pass

- [ ] **Step 3: Dry-run configure for all envs**

Run:
```bash
pnpm infra:configure --env sandbox
pnpm infra:configure --env staging
pnpm infra:configure --env production
```
Expected: exit 0; six layer YAMLs updated per env.

- [ ] **Step 4: Manual sandbox deploy** (requires live GCP project — operator task)

Follow updated README with a real project ID.

---

## Out of scope (follow-up)

- `pnpm infra:secrets:status` / `pnpm infra:secrets:set` helpers (spec §6 optional).
- Artifact Registry image preflight warning on deploy (spec §5 — defer unless sandbox deploy hits this often).
- Auto-writing merged keys back into `config.<env>.yaml` (only fan-out to Pulumi YAML in v1).

---

## Spec coverage self-review

| Spec section | Task |
|--------------|------|
| Config file layout | Task 4 |
| Schema + defaults matrix | Task 4 |
| configure command | Task 5 |
| Tiered validation | Task 2 |
| Fan-out + stack refs | Task 3 |
| Secrets out of config + checklist | Task 5, 6 |
| init → configure | Task 6 |
| README workflow | Task 7 |
| Critical tests | Tasks 1–3 |
| Idempotent merge on rerun | Task 1 |

No placeholders remain. Types consistent across tasks.
