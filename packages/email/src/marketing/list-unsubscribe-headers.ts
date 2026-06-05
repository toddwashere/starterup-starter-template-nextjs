export function buildListUnsubscribeHeaders(oneClickUnsubscribeUrl: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${oneClickUnsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
