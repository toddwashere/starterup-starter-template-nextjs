export class InsufficientCreditsError extends Error {
  readonly code = "INSUFFICIENT_CREDITS";
  readonly organizationId: string;
  readonly balanceCredits: number;

  constructor(input: { organizationId: string; balanceCredits: number }) {
    super("Insufficient credits");
    this.name = "InsufficientCreditsError";
    this.organizationId = input.organizationId;
    this.balanceCredits = input.balanceCredits;
  }
}

export class CreditConfigurationError extends Error {
  readonly code = "CREDIT_CONFIGURATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "CreditConfigurationError";
  }
}
