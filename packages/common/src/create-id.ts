import { createId as createCuidId, init } from "@paralleldrive/cuid2";

export type AuthIdPrefix =
  | "user"
  | "sess"
  | "acct"
  | "ver"
  | "jwks"
  | "org"
  | "mbr"
  | "authinv"
  | "apikey"
  | "oauthclient"
  | "oauthat"
  | "oauthrt"
  | "oauthc";

export type ContactsIdPrefix =
  | "contact"
  | "company"
  | "staddr"
  | "cstage"
  | "ctag"
  | "cseg"
  | "cint"
  | "ctask"
  | "ctstatus";

export type BillingIdPrefix = "bplan" | "sub" | "price" | "prod" | "inv" | "pay";

export type McpIdPrefix = "mcptcl";

export type AiIdPrefix = "aith" | "aimsg";

export type CampaignsIdPrefix =
  | "eseq" // EmailSequence
  | "estep" // EmailSequenceStep
  | "ecrun" // EmailCampaignRun
  | "eenrl" // EmailEnrollment
  | "esend" // EmailStepSend
  | "eclk" // EmailLinkClick
  | "edevt" // EmailDeliveryEvent
  | "epref"; // ContactEmailPreference

export type IdPrefix =
  | AuthIdPrefix
  | ContactsIdPrefix
  | BillingIdPrefix
  | McpIdPrefix
  | AiIdPrefix
  | CampaignsIdPrefix
  | "tmp";

const temporaryIdPrefix = "tmp" satisfies IdPrefix;

export function createId(prefix?: IdPrefix, length = 16) {
  if (!prefix) {
    return createCuidId();
  }
  return `${prefix}_${createIdOfLength(length)}`;
}

export function createIdOfLength(length: number) {
  return init({ length })();
}

export function createIdTemporary() {
  return createId(temporaryIdPrefix);
}

export function isTemporaryId(id: string) {
  return id.startsWith(`${temporaryIdPrefix}_`);
}
