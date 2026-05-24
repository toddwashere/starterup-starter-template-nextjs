export {
  createInitOptions,
  initClientSentry,
  initServerSentry,
  initEdgeSentry,
} from "./init";
export { withSentryConfig } from "./with-sentry-config";
// createGlobalError is exported via the separate "./next/global-error" entry
// to avoid loading React/JSX into the next.config.ts evaluation context.
