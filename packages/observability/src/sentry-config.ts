import { keys } from "../keys";

export type SentryAppId =
  | "dashboard"
  | "www"
  | "public-api"
  | "workers"
  | "public-mcp";

export type SentryAppConfig = {
  enabled: boolean;
  errors: boolean;
  tracing: boolean;
  tracesSampleRate: number;
  logs: boolean;
  replay: boolean;
  replaysSessionSampleRate: number;
  replaysOnErrorSampleRate: number;
};

export const sentryApps: Record<SentryAppId, SentryAppConfig> = {
  dashboard: {
    enabled: true,
    errors: true,
    tracing: false,
    tracesSampleRate: 0.1,
    logs: false,
    replay: false,
    replaysSessionSampleRate: 0.05,
    replaysOnErrorSampleRate: 1.0,
  },
  www: {
    enabled: true,
    errors: true,
    tracing: false,
    tracesSampleRate: 0.1,
    logs: false,
    replay: false,
    replaysSessionSampleRate: 0.05,
    replaysOnErrorSampleRate: 1.0,
  },
  "public-api": {
    enabled: false,
    errors: true,
    tracing: false,
    tracesSampleRate: 0.1,
    logs: false,
    replay: false,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  },
  workers: {
    enabled: false,
    errors: true,
    tracing: false,
    tracesSampleRate: 0.1,
    logs: false,
    replay: false,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  },
  "public-mcp": {
    enabled: false,
    errors: true,
    tracing: false,
    tracesSampleRate: 0.1,
    logs: false,
    replay: false,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  },
};

export function resolveSentryConfig(appId: SentryAppId): {
  active: boolean;
  app: SentryAppConfig;
  dsn: string;
} | null {
  const { SENTRY_DSN } = keys();
  if (!SENTRY_DSN) return null;

  const app = sentryApps[appId];
  if (!app.enabled) return null;

  return { active: true, app, dsn: SENTRY_DSN };
}
