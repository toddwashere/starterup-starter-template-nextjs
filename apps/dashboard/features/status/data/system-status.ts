export type CheckState =
  | "ready"
  | "not-ready"
  | "configured"
  | "enabled";

export type StatusCheck = {
  id: string;
  label: string;
  state: CheckState;
  message: string;
};

export type ProbeResults = {
  databaseOk: boolean;
  authOk: boolean;
};

export type SystemStatus = {
  status: "ready" | "not-ready";
  checks: StatusCheck[];
};

export type EnvMap = Record<string, string | undefined>;

const EMAIL_ENV_KEYS = [
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "EMAIL_PROVIDER",
  "RESEND_WEBHOOK_SECRET",
] as const;

const QUEUE_ENV_KEYS = [
  "WORKER_QUEUE_ADAPTER",
  "REDIS_URL",
  "SQS_QUEUE_URL",
  "GCP_PROJECT_ID",
  "PUBSUB_TOPIC_NAME",
  "PUBSUB_SUBSCRIPTION_NAME",
  "SERVICEBUS_CONNECTION_STRING",
  "AWS_ROLE_ARN",
] as const;

const STRIPE_ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
] as const;

const OBSERVABILITY_ENV_KEYS = [
  "SENTRY_DSN",
  "NEXT_PUBLIC_SENTRY_DSN",
  "NEXT_PUBLIC_POSTHOG_TOKEN",
] as const;

const PLACEHOLDER_PATTERNS = [
  /^sk_test_x+$/i,
  /^pk_test_x+$/i,
  /^whsec_x+$/i,
  /^change-me/i,
  /^x+$/i,
];

export function isEnvSet(env: EnvMap, key: string): boolean {
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0;
}

export function isPlaceholderSecret(value: string): boolean {
  const trimmed = value.trim();
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function anyEnvSet(env: EnvMap, keys: readonly string[]): boolean {
  return keys.some((key) => isEnvSet(env, key));
}

function anyNonPlaceholderEnvSet(env: EnvMap, keys: readonly string[]): boolean {
  return keys.some((key) => {
    const value = env[key];
    return (
      typeof value === "string" &&
      value.trim().length > 0 &&
      !isPlaceholderSecret(value)
    );
  });
}

export function buildSystemStatus(
  probes: ProbeResults,
  env: EnvMap,
): SystemStatus {
  const checks: StatusCheck[] = [
    {
      id: "database",
      label: "Database connection",
      state: probes.databaseOk ? "ready" : "not-ready",
      message: probes.databaseOk
        ? "Database connection is healthy."
        : "Database connection is unavailable.",
    },
    {
      id: "auth",
      label: "Auth service",
      state: probes.authOk ? "ready" : "not-ready",
      message: probes.authOk
        ? "Auth URL is reachable."
        : "Auth URL could not be reached.",
    },
  ];

  if (anyEnvSet(env, EMAIL_ENV_KEYS)) {
    checks.push({
      id: "email",
      label: "Email",
      state: "configured",
      message: "Email provider environment is configured.",
    });
  }

  if (anyEnvSet(env, QUEUE_ENV_KEYS)) {
    const adapter = env.WORKER_QUEUE_ADAPTER?.trim() || "default";
    checks.push({
      id: "queue",
      label: "Worker queue",
      state: "configured",
      message: `Queue adapter "${adapter}" environment is configured.`,
    });
  }

  if (anyNonPlaceholderEnvSet(env, STRIPE_ENV_KEYS)) {
    checks.push({
      id: "billing",
      label: "Billing (Stripe)",
      state: "configured",
      message: "Stripe environment is configured.",
    });
  }

  if (anyEnvSet(env, OBSERVABILITY_ENV_KEYS)) {
    checks.push({
      id: "observability",
      label: "Observability",
      state: "enabled",
      message: "Error/analytics reporting is enabled.",
    });
  }

  return {
    status: probes.databaseOk && probes.authOk ? "ready" : "not-ready",
    checks,
  };
}
