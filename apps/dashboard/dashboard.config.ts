export const dashboardConfig = {
  features: {
    credits: {
      showInBilling: true,
      showInAiChat: true,
      showLowBalanceWarnings: true,
      // Total balance at or below which the chat warns the user to top up.
      lowBalanceWarningThresholdCredits: 5_000,
    },
  },
} as const;
