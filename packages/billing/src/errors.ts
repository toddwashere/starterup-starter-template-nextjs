export class BillingEntitlementError extends Error {
  readonly feature: string;
  readonly limit: number;
  readonly usage: number;

  constructor({
    feature,
    limit,
    usage,
  }: {
    feature: string;
    limit: number;
    usage: number;
  }) {
    super(`Billing limit reached for "${feature}": ${usage} of ${limit}.`);
    this.name = "BillingEntitlementError";
    this.feature = feature;
    this.limit = limit;
    this.usage = usage;
  }
}
