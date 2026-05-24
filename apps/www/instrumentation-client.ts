import { initClientSentry } from "@workspace/observability/next";
import { initClientPostHog } from "@workspace/observability/posthog";

initClientSentry("www");
initClientPostHog("www");
