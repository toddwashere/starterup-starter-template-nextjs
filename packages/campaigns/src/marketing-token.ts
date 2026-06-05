import { createHmac, timingSafeEqual } from "node:crypto";
import { keys } from "../keys";

export type MarketingTokenScope = "all" | "sequence" | "click";

export type MarketingTokenPayload = {
  contactId: string;
  organizationId: string;
  scope: MarketingTokenScope;
  sequenceId?: string;
  stepSendId?: string;
  destinationUrl?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  exp: number;
};

export function signMarketingToken(
  payload: Omit<MarketingTokenPayload, "exp">,
  ttlDays = 90,
): string {
  const secret = keys().CAMPAIGN_UNSUBSCRIBE_SECRET;
  if (!secret) {
    throw new Error("CAMPAIGN_UNSUBSCRIBE_SECRET is not configured");
  }
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86400;
  const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyMarketingToken(token: string): MarketingTokenPayload {
  const [body, sig] = token.split(".");
  if (!body || !sig) {
    throw new Error("Invalid token");
  }
  const secret = keys().CAMPAIGN_UNSUBSCRIBE_SECRET;
  if (!secret) {
    throw new Error("CAMPAIGN_UNSUBSCRIBE_SECRET is not configured");
  }
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const sigBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expected);
  if (
    sigBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    throw new Error("Invalid token signature");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as MarketingTokenPayload;
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Token expired");
  }
  return payload;
}
