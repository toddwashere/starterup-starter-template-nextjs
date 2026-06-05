import { verifyMarketingToken, recordLinkClick } from "@workspace/campaigns";
import { appendUtmParams } from "@/features/campaigns/public/click-redirect";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  try {
    const payload = verifyMarketingToken(token);
    if (payload.scope !== "click" || !payload.destinationUrl || !payload.stepSendId) {
      return new Response("Invalid link", { status: 400 });
    }

    await recordLinkClick({
      stepSendId: payload.stepSendId,
      destinationUrl: payload.destinationUrl,
      utmSource: "email",
      utmMedium: payload.utmMedium ?? "campaign",
      utmCampaign: payload.utmCampaign ?? "",
      utmContent: payload.utmContent ?? "",
    });

    const url = appendUtmParams(payload.destinationUrl, {
      utm_source: "email",
      utm_medium: payload.utmMedium ?? "campaign",
      utm_campaign: payload.utmCampaign ?? "",
      utm_content: payload.utmContent ?? "",
    });

    return Response.redirect(url, 302);
  } catch {
    return new Response("Invalid link", { status: 400 });
  }
}
