export type UtmParams = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
};

export function appendUtmParams(destinationUrl: string, params: UtmParams): string {
  const url = new URL(destinationUrl);
  if (params.utm_source) {
    url.searchParams.set("utm_source", params.utm_source);
  }
  if (params.utm_medium) {
    url.searchParams.set("utm_medium", params.utm_medium);
  }
  if (params.utm_campaign) {
    url.searchParams.set("utm_campaign", params.utm_campaign);
  }
  if (params.utm_content) {
    url.searchParams.set("utm_content", params.utm_content);
  }
  return url.toString();
}
