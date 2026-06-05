// Public API exports
export { keys } from "../keys";

export {
  marketingTemplateRegistry,
  type MarketingTemplateKey,
} from "./template-registry";

export {
  signMarketingToken,
  verifyMarketingToken,
  type MarketingTokenPayload,
  type MarketingTokenScope,
} from "./marketing-token";

export * from "./schemas/sequence-schemas";

export * from "./data-models/email-sequence-repo";
export * from "./data-models/email-campaign-run-repo";
export * from "./data-models/email-enrollment-repo";
export * from "./data-models/email-step-send-repo";
export * from "./data-models/email-preference-repo";
export * from "./data-models/email-link-click-repo";
export * from "./data-models/email-delivery-event-repo";

export * from "./services/sequence-service";
export * from "./services/enrollment-service";
export * from "./services/campaign-run-service";
export * from "./services/step-send-service";
export * from "./services/preference-service";
export * from "./services/reporting-service";
export * from "./services/delivery-event-service";
