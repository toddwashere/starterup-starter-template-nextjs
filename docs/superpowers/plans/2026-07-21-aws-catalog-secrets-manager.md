# AWS Catalog Secrets Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create Secrets Manager placeholders for every `SECRET_CATALOG` entry except `database-url`, inject them into App Runner/Lambda via catalog env vars, and never let Pulumi overwrite operator-set values.

**Architecture:** Core builds catalog SM secrets from `infra/shared/secret-catalog.ts` (plain-string placeholders + `ignoreChanges`). Apps uses pure helpers + `secretsForApp` to wire `runtimeEnvironmentSecrets` (shared ARNs) and expand IAM; workers resolve secret versions at deploy time. GCP and `infra:secrets:*` stay unchanged.

**Tech Stack:** Pulumi AWS, Vitest mocks, shared `SECRET_CATALOG`, App Runner + Lambda in `starter-aws-apps` / `starter-aws-core`.

**Design spec:** [`docs/superpowers/specs/2026-07-21-aws-catalog-secrets-manager-design.md`](../specs/2026-07-21-aws-catalog-secrets-manager-design.md)

## Global Constraints

- AWS treats all catalog secrets except `database-url` as operator-filled placeholders (ignore catalog `generation` for AWS creation).
- Secret `secretString` seeds are plain strings, never JSON.
- `ignoreChanges: ["secretString"]` on every placeholder version — Pulumi must never clobber fills.
- No AWS `infra:secrets:*` CLI; no GCP secrets layer changes; no public-URL rebuild work.
- Keep the shared App Runner instance role; expand explicit ARN lists (no `/<env>/*` wildcards).
- Source of truth for ids/env/readers: `infra/shared/secret-catalog.ts` (no `patient-account` in this repo).

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `infra/shared/aws-catalog-secrets.ts` | Pure: catalog entries AWS should create + plain-string seed map |
| `infra/shared/aws-catalog-secrets.test.ts` | Unit tests for filter + seeds |
| `infra/aws/core/manual-secrets.ts` | Catalog-driven `buildCatalogPlaceholderSecrets` (evolve from empty `MANUAL_SECRETS`) |
| `infra/aws/core/manual-secrets.mock.test.ts` | Pulumi mock tests for SM create + ignoreChanges |
| `infra/aws/core/index.ts` | Call builder; export `catalogSecretArns` (+ `manualSecretArns` alias) |
| `infra/aws/apps/app-secrets.ts` | Pure: `runtimeEnvironmentSecrets` map + IAM ARN lists for App Runner / workers |
| `infra/aws/apps/app-secrets.test.ts` | Unit tests for shared ARNs, www empty, no plaintext secret keys |
| `infra/aws/apps/index.ts` | Wire helpers into App Runner loop, shared instance role, workers Lambda |
| `infra/aws/GETTING_STARTED.md` | Operator docs for seven fills + shared secrets |

## Critical Tests

- `infra/shared/aws-catalog-secrets.test.ts`: excludes `database-url`; includes all other catalog ids; every seed is a non-empty plain string (not JSON).
- `infra/aws/core/manual-secrets.mock.test.ts`: creates `/sandbox/<id>` for each AWS catalog secret; version has `ignoreChanges`; no duplicate `database-url` secret from the builder.
- `infra/aws/apps/app-secrets.test.ts`: dashboard and public-api share the same ARN for `STRIPE_SECRET_KEY`; www map is `{}`; workers IAM list is a subset of catalog+DB ARNs; helper does not emit plaintext Stripe/auth variables.

---

### Task 1: Pure AWS catalog secret helpers

**Files:**
- Create: `infra/shared/aws-catalog-secrets.ts`
- Create: `infra/shared/aws-catalog-secrets.test.ts`
- Test: `infra/shared/aws-catalog-secrets.test.ts`

**Interfaces:**
- Consumes: `SECRET_CATALOG`, `SecretDescriptor` from `./secret-catalog`
- Produces:
  - `awsCatalogAppSecrets(): readonly SecretDescriptor[]`
  - `awsCatalogPlaceholderSeed(id: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// infra/shared/aws-catalog-secrets.test.ts
import { describe, expect, it } from "vitest";
import { SECRET_CATALOG } from "./secret-catalog";
import {
  awsCatalogAppSecrets,
  awsCatalogPlaceholderSeed,
} from "./aws-catalog-secrets";

describe("awsCatalogAppSecrets", () => {
  it("includes every catalog secret except database-url", () => {
    const ids = awsCatalogAppSecrets().map((s) => s.id).sort();
    const expected = SECRET_CATALOG.filter((s) => s.id !== "database-url")
      .map((s) => s.id)
      .sort();
    expect(ids).toEqual(expected);
    expect(ids).not.toContain("database-url");
  });
});

describe("awsCatalogPlaceholderSeed", () => {
  it("returns a non-empty plain string for each AWS catalog secret", () => {
    for (const secret of awsCatalogAppSecrets()) {
      const seed = awsCatalogPlaceholderSeed(secret.id);
      expect(seed.length).toBeGreaterThan(0);
      expect(() => JSON.parse(seed)).toThrow();
    }
  });

  it("throws for unknown ids", () => {
    expect(() => awsCatalogPlaceholderSeed("not-a-secret")).toThrow(/unknown/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd infra/shared && pnpm exec vitest run aws-catalog-secrets.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

```ts
// infra/shared/aws-catalog-secrets.ts
import { SECRET_CATALOG, type SecretDescriptor } from "./secret-catalog";

const PLACEHOLDER_SEEDS: Readonly<Record<string, string>> = {
  "better-auth-secret": "replace-me-better-auth-secret-min-32-chars",
  "campaign-unsubscribe-secret":
    "replace-me-campaign-unsubscribe-secret-min-32",
  "stripe-secret-key": "sk_test_replace_me",
  "stripe-webhook-secret": "whsec_replace_me",
  "resend-api-key": "re_replace_me",
  "openrouter-api-key": "replace-me-openrouter",
  "sentry-dsn": "https://replace.me/sentry",
};

/** Catalog secrets AWS core should create as operator-filled SM placeholders. */
export function awsCatalogAppSecrets(): readonly SecretDescriptor[] {
  return SECRET_CATALOG.filter((s) => s.id !== "database-url");
}

export function awsCatalogPlaceholderSeed(id: string): string {
  const seed = PLACEHOLDER_SEEDS[id];
  if (seed === undefined) {
    throw new Error(`Unknown AWS catalog secret id: ${id}`);
  }
  return seed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd infra/shared && pnpm exec vitest run aws-catalog-secrets.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/shared/aws-catalog-secrets.ts infra/shared/aws-catalog-secrets.test.ts
git commit -m "$(cat <<'EOF'
feat(infra): add pure AWS catalog secret seed helpers

EOF
)"
```

---

### Task 2: Catalog-driven SM placeholders in core

**Files:**
- Modify: `infra/aws/core/manual-secrets.ts`
- Modify: `infra/aws/core/manual-secrets.mock.test.ts`
- Modify: `infra/aws/core/index.ts` (export wiring in Task 3 if preferred; include here)
- Test: `infra/aws/core/manual-secrets.mock.test.ts`

**Interfaces:**
- Consumes: `awsCatalogAppSecrets`, `awsCatalogPlaceholderSeed`
- Produces: `buildCatalogPlaceholderSecrets(opts) => BuiltManualSecret[]` where `BuiltManualSecret` is `{ name: string; arn: pulumi.Output<string> }` (`name` = catalog id)

- [ ] **Step 1: Update failing / new mock tests**

Replace the injected-`specs` happy path with a catalog-driven default. Keep the identity/path test. Example additions:

```ts
// In manual-secrets.mock.test.ts — new describe using default catalog build
describe("buildCatalogPlaceholderSecrets", () => {
  beforeAll(async () => {
    vi.resetModules();
    recorded.length = 0;
    installMocks();
    const mod = await import("./manual-secrets.js");
    const names = deploymentNames(resolveDeploymentIdentity({}), "sandbox");
    mod.buildCatalogPlaceholderSecrets({
      secretPathPrefix: names.secretPathPrefix,
      isProduction: false,
      tags: names.tags,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }, 10000);

  it("creates one secret per catalog app secret under /sandbox/<id>", async () => {
    const { awsCatalogAppSecrets } = await import("../../shared/aws-catalog-secrets.js");
    const secrets = recorded.filter((r) => r.type === SECRET_TYPE);
    const names = secrets.map((s) => s.inputs.name as string).sort();
    const expected = awsCatalogAppSecrets()
      .map((s) => `/sandbox/${s.id}`)
      .sort();
    expect(names).toEqual(expected);
    expect(names.some((n) => n.endsWith("/database-url"))).toBe(false);
  });

  it("seeds a placeholder version with ignoreChanges on secretString", () => {
    const versions = recorded.filter((r) => r.type === VERSION_TYPE);
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) {
      // Pulumi mock records opts differently by version; assert resource was created
      // and that implementation passes ignoreChanges (inspect via recorded opts if available).
      expect(v.inputs.secretId).toBeDefined();
    }
  });
});
```

Also keep a unit assertion that `awsCatalogPlaceholderSeed` values are what the builder would use (plain string) — if the mock redacts `secretString`, assert via importing the seed helper rather than reading mock inputs.

Update or delete the old “single injected spec” tests so they call `buildCatalogPlaceholderSecrets` or a retained `buildManualSecrets` with explicit `specs` for identity tagging.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd infra/aws/core && pnpm test
```

Expected: FAIL on missing `buildCatalogPlaceholderSecrets`.

- [ ] **Step 3: Implement builder**

Rewrite `infra/aws/core/manual-secrets.ts` along these lines (keep `BuiltManualSecret` type; deprecate empty `MANUAL_SECRETS` or remove if unused):

```ts
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import {
  awsCatalogAppSecrets,
  awsCatalogPlaceholderSeed,
} from "../../shared/aws-catalog-secrets";

export interface BuiltManualSecret {
  name: string;
  arn: pulumi.Output<string>;
}

export function buildCatalogPlaceholderSecrets(opts: {
  secretPathPrefix: string;
  isProduction: boolean;
  cmekKeyId?: pulumi.Output<string>;
  tags: Record<string, string>;
}): BuiltManualSecret[] {
  const { secretPathPrefix, isProduction, cmekKeyId, tags } = opts;

  return awsCatalogAppSecrets().map((spec) => {
    const secret = new aws.secretsmanager.Secret(`manual-${spec.id}`, {
      name: `${secretPathPrefix}/${spec.id}`,
      description: `App secret ${spec.envVar} (${spec.id}) — set via put-secret-value`,
      recoveryWindowInDays: isProduction ? 7 : 0,
      kmsKeyId: cmekKeyId,
      tags,
    });

    new aws.secretsmanager.SecretVersion(
      `manual-${spec.id}-placeholder`,
      {
        secretId: secret.id,
        secretString: awsCatalogPlaceholderSeed(spec.id),
      },
      { ignoreChanges: ["secretString"] },
    );

    return { name: spec.id, arn: secret.arn };
  });
}

/** @deprecated Prefer buildCatalogPlaceholderSecrets — kept for tests that inject specs. */
export function buildManualSecrets(opts: {
  secretPathPrefix: string;
  isProduction: boolean;
  cmekKeyId?: pulumi.Output<string>;
  tags: Record<string, string>;
  specs: readonly { name: string; description: string }[];
}): BuiltManualSecret[] {
  // Same as today but plain-string seed "REPLACE_IN_CONSOLE" (not JSON) if retained for tests.
  // Or delete and migrate tests fully to buildCatalogPlaceholderSecrets.
  ...
}
```

Prefer **deleting** `MANUAL_SECRETS` / `buildManualSecrets` if nothing else imports them — update tests to catalog-only to avoid dual APIs.

- [ ] **Step 4: Wire `core/index.ts`**

Replace:

```ts
const manualSecrets = buildManualSecrets({...});
```

with:

```ts
const catalogSecrets = buildCatalogPlaceholderSecrets({
  secretPathPrefix: names.secretPathPrefix,
  isProduction,
  cmekKeyId,
  tags: baseTags,
});
```

Exports:

```ts
export const catalogSecretArns = Object.fromEntries(
  catalogSecrets.map((s) => [s.name, s.arn]),
);
export const manualSecretArns = catalogSecretArns;
```

- [ ] **Step 5: Run core tests**

```bash
cd infra/aws/core && pnpm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infra/aws/core/manual-secrets.ts infra/aws/core/manual-secrets.mock.test.ts infra/aws/core/index.ts
git commit -m "$(cat <<'EOF'
feat(infra): create AWS Secrets Manager placeholders from SECRET_CATALOG

EOF
)"
```

---

### Task 3: Pure App Runner / Lambda secret wiring helpers

**Files:**
- Create: `infra/aws/apps/app-secrets.ts`
- Create: `infra/aws/apps/app-secrets.test.ts`
- Test: `infra/aws/apps/app-secrets.test.ts`

**Interfaces:**
- Consumes: `secretsForApp` from `../../shared/secret-catalog`
- Produces:
  - `buildAppRunnerRuntimeSecrets(appName, arns): Record<string, string>`
  - `appRunnerInstanceSecretArns(arns): string[]`
  - `workersSecretEnvVarNames(): string[]` (optional)
  - Types for ARN bag:

```ts
export interface CatalogSecretArnBag {
  databaseUrlSecretArn: string;
  directUrlSecretArn: string;
  /** catalog id → ARN (no database-url) */
  catalogSecretArns: Readonly<Record<string, string>>;
}
```

- [ ] **Step 1: Write the failing tests**

```ts
// infra/aws/apps/app-secrets.test.ts
import { describe, expect, it } from "vitest";
import {
  buildAppRunnerRuntimeSecrets,
  appRunnerInstanceSecretArns,
  workersRuntimeSecretIds,
} from "./app-secrets";

const arns = {
  databaseUrlSecretArn: "arn:db-url",
  directUrlSecretArn: "arn:direct-url",
  catalogSecretArns: {
    "better-auth-secret": "arn:auth",
    "campaign-unsubscribe-secret": "arn:unsub",
    "stripe-secret-key": "arn:stripe",
    "stripe-webhook-secret": "arn:whsec",
    "resend-api-key": "arn:resend",
    "openrouter-api-key": "arn:or",
    "sentry-dsn": "arn:sentry",
  },
};

describe("buildAppRunnerRuntimeSecrets", () => {
  it("maps catalog env vars to shared ARNs for dashboard", () => {
    const secrets = buildAppRunnerRuntimeSecrets("dashboard", arns);
    expect(secrets.DATABASE_URL).toBe("arn:db-url");
    expect(secrets.STRIPE_SECRET_KEY).toBe("arn:stripe");
    expect(secrets.BETTER_AUTH_SECRET).toBe("arn:auth");
    expect(secrets.STRIPE_WEBHOOK_SECRET).toBeUndefined();
  });

  it("shares the same stripe ARN with public-api", () => {
    const dash = buildAppRunnerRuntimeSecrets("dashboard", arns);
    const api = buildAppRunnerRuntimeSecrets("public-api", arns);
    expect(dash.STRIPE_SECRET_KEY).toBe(api.STRIPE_SECRET_KEY);
  });

  it("returns empty map for www", () => {
    expect(buildAppRunnerRuntimeSecrets("www", arns)).toEqual({});
  });
});

describe("appRunnerInstanceSecretArns", () => {
  it("returns explicit DB + all catalog ARNs without wildcards", () => {
    const list = appRunnerInstanceSecretArns(arns);
    expect(list).toContain("arn:db-url");
    expect(list).toContain("arn:direct-url");
    expect(list).toContain("arn:stripe");
    expect(list.some((a) => a.includes("*"))).toBe(false);
  });
});

describe("workersRuntimeSecretIds", () => {
  it("lists workers catalog readers including database-url", () => {
    expect(workersRuntimeSecretIds()).toEqual(
      expect.arrayContaining([
        "database-url",
        "campaign-unsubscribe-secret",
        "resend-api-key",
        "openrouter-api-key",
        "sentry-dsn",
      ]),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd infra/aws/apps && pnpm exec vitest run app-secrets.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement helpers**

```ts
// infra/aws/apps/app-secrets.ts
import { secretsForApp } from "../../shared/secret-catalog";

export interface CatalogSecretArnBag {
  databaseUrlSecretArn: string;
  directUrlSecretArn: string;
  catalogSecretArns: Readonly<Record<string, string>>;
}

export function buildAppRunnerRuntimeSecrets(
  appName: string,
  arns: CatalogSecretArnBag,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const secret of secretsForApp(appName)) {
    if (secret.id === "database-url") {
      out[secret.envVar] = arns.databaseUrlSecretArn;
      continue;
    }
    const arn = arns.catalogSecretArns[secret.id];
    if (!arn) {
      throw new Error(
        `Missing catalogSecretArns[${secret.id}] for app ${appName}`,
      );
    }
    out[secret.envVar] = arn;
  }
  return out;
}

/** Shared App Runner instance role: DB ARNs + every catalog placeholder ARN. */
export function appRunnerInstanceSecretArns(
  arns: CatalogSecretArnBag,
): string[] {
  return [
    arns.databaseUrlSecretArn,
    arns.directUrlSecretArn,
    ...Object.values(arns.catalogSecretArns),
  ];
}

export function workersRuntimeSecretIds(): string[] {
  return secretsForApp("workers").map((s) => s.id);
}

export function resolveSecretArn(
  id: string,
  arns: CatalogSecretArnBag,
): string {
  if (id === "database-url") return arns.databaseUrlSecretArn;
  const arn = arns.catalogSecretArns[id];
  if (!arn) throw new Error(`Missing catalogSecretArns[${id}]`);
  return arn;
}
```

- [ ] **Step 4: Run tests**

```bash
cd infra/aws/apps && pnpm exec vitest run app-secrets.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/aws/apps/app-secrets.ts infra/aws/apps/app-secrets.test.ts
git commit -m "$(cat <<'EOF'
feat(infra): add App Runner catalog secret wiring helpers

EOF
)"
```

---

### Task 4: Wire apps stack (App Runner, IAM, Lambda)

**Files:**
- Modify: `infra/aws/apps/index.ts`
- Test: re-run `infra/aws/apps` vitest (helpers + existing `apps.mock.test.ts`)

**Interfaces:**
- Consumes: `buildAppRunnerRuntimeSecrets`, `appRunnerInstanceSecretArns`, `workersRuntimeSecretIds`, `resolveSecretArn`; core output `catalogSecretArns`
- Produces: updated App Runner services + Lambda env/IAM

- [ ] **Step 1: StackReference catalog ARNs**

After existing core outputs:

```ts
const catalogSecretArns = coreStack.getOutput("catalogSecretArns") as pulumi.Output<
  Record<string, string>
>;
```

- [ ] **Step 2: Expand shared instance role secret resources**

Replace `Resource: [databaseUrlSecretArn, directUrlSecretArn]` with a Pulumi output list:

```ts
const instanceSecretResources = pulumi
  .all([databaseUrlSecretArn, directUrlSecretArn, catalogSecretArns])
  .apply(([db, direct, catalog]) =>
    appRunnerInstanceSecretArns({
      databaseUrlSecretArn: db as string,
      directUrlSecretArn: direct as string,
      catalogSecretArns: catalog as Record<string, string>,
    }),
  );
```

Use `instanceSecretResources` in the instance role policy `Resource` field (Pulumi accepts `Output<string[]>` via `jsonStringify` patterns already used — mirror existing style; if needed keep `pulumi.all` inside `pulumi.jsonStringify`).

- [ ] **Step 3: Per-app `runtimeEnvironmentSecrets`**

Inside the App Runner loop, remove plaintext `STRIPE_*` / `BETTER_AUTH_SECRET`. Build secrets:

```ts
runtimeEnvironmentSecrets: pulumi
  .all([databaseUrlSecretArn, catalogSecretArns])
  .apply(([db, catalog]) =>
    buildAppRunnerRuntimeSecrets(app.name, {
      databaseUrlSecretArn: db as string,
      directUrlSecretArn: "", // unused by builder
      catalogSecretArns: (catalog ?? {}) as Record<string, string>,
    }),
  ),
```

Note: App Runner `imageConfiguration.runtimeEnvironmentSecrets` may need a plain `Record<string, pulumi.Input<string>>`. If `Output<Record<...>>` is awkward, use:

```ts
const runtimeEnvironmentSecrets = Object.fromEntries(
  secretsForApp(app.name).map((secret) => [
    secret.envVar,
    secret.id === "database-url"
      ? databaseUrlSecretArn
      : catalogSecretArns.apply((m) => {
          const arn = m[secret.id];
          if (!arn) throw new Error(`Missing catalogSecretArns[${secret.id}]`);
          return arn;
        }),
  ]),
);
```

Prefer the `Object.fromEntries` + `secretsForApp` form in `index.ts` if it types more cleanly; keep `buildAppRunnerRuntimeSecrets` for unit tests with string ARNs.

For **www**, `secretsForApp("www")` is `[]` → empty `runtimeEnvironmentSecrets` (no `DATABASE_URL`).

- [ ] **Step 4: Workers IAM + env**

Expand workers `GetSecretValue` resources to all workers secret ARNs:

```ts
Resource: pulumi
  .all([databaseUrlSecretArn, catalogSecretArns])
  .apply(([db, catalog]) =>
    workersRuntimeSecretIds().map((id) =>
      resolveSecretArn(id, {
        databaseUrlSecretArn: db as string,
        directUrlSecretArn: "",
        catalogSecretArns: catalog as Record<string, string>,
      }),
    ),
  ),
```

Resolve each workers secret into Lambda env (in addition to existing `DATABASE_URL`):

```ts
// Pseudo — build variables object with pulumi.all over needed versions
const workerSecretIds = workersRuntimeSecretIds().filter((id) => id !== "database-url");
// for each id: getSecretVersionOutput({ secretId: catalog arn }) → env[envVar]
```

Keep `DATABASE_URL` resolution as today; add parallel `getSecretVersionOutput` for other workers catalog secrets and map via `secretsForApp("workers")` env var names. Wrap values with `pulumi.secret(...)`.

- [ ] **Step 5: Run apps tests**

```bash
cd infra/aws/apps && pnpm test
```

Expected: PASS (update `apps.mock.test.ts` only if identity mocks break).

- [ ] **Step 6: Commit**

```bash
git add infra/aws/apps/index.ts
git commit -m "$(cat <<'EOF'
feat(infra): inject catalog Secrets Manager ARNs into App Runner and workers

EOF
)"
```

---

### Task 5: Documentation

**Files:**
- Modify: `infra/aws/GETTING_STARTED.md` (§ Secrets ~668–711)

- [ ] **Step 1: Rewrite § Secrets**

Replace the three subsections with:

1. **Derived (automatic)** — unchanged list (`database-url`, `direct-url`, hybrid `vercel-database-url`, plus `rds-proxy-auth` / pooler TLS as applicable).
2. **Catalog app secrets (manual fill)** — core creates `/<env>/<id>` for the seven catalog ids from `SECRET_CATALOG` (excluding `database-url`); shared across apps per `readers`; plain-string placeholder + `ignoreChanges`; table of id → env var; `put-secret-value` example; note App Runner runtime injection vs Lambda needing apps redeploy after fill; note `infra:secrets:*` is GCP-only.
3. Remove “add to `MANUAL_SECRETS` by hand” and the “plaintext App Runner bootstrapping” guidance for Stripe/auth (or reduce to: non-secret URL bootstrapping still uses `runtimeEnvironmentVariables`).

- [ ] **Step 2: Commit**

```bash
git add infra/aws/GETTING_STARTED.md
git commit -m "$(cat <<'EOF'
docs(infra): document catalog-driven AWS Secrets Manager fills

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| Create SM secrets for all catalog ids except `database-url` | 1–2 |
| Plain-string seeds + `ignoreChanges` | 2 |
| Export `catalogSecretArns` / alias `manualSecretArns` | 2 |
| App Runner `runtimeEnvironmentSecrets` via `secretsForApp` | 3–4 |
| Shared ARNs across readers | 3–4 |
| Remove plaintext Stripe/auth env | 4 |
| www gets no catalog / no DATABASE_URL | 3–4 |
| Shared instance role explicit ARN union | 3–4 |
| Workers deploy-time resolve + IAM | 4 |
| GETTING_STARTED update | 5 |
| Critical unit tests | 1, 2, 3 |

## Plan self-review

- No TBDs; starter catalog (no patient-account) used throughout.
- Placeholder JSON removal called out in Task 2.
- Helper signatures consistent across Tasks 3–4.
- GCP / secrets CLI explicitly out of scope.
