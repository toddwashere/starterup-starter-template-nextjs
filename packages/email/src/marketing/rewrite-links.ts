export function rewriteLinksForTracking(
  html: string,
  buildRedirectUrl: (destinationUrl: string) => string,
): string {
  return html.replace(
    /href="(https?:\/\/[^"]+)"/gi,
    (_match, url: string) => `href="${buildRedirectUrl(url)}"`,
  );
}
