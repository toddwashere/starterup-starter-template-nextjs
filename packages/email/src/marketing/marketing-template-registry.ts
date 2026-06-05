import { z } from "zod";
import { NurtureIntroEmail } from "../templates/marketing/nurture-intro-email";

export const marketingTemplateRegistry = {
  "nurture-intro": {
    label: "Nurture intro",
    description: "Short intro with single CTA",
    component: NurtureIntroEmail,
    propsSchema: z.object({
      bodyIntro: z.string(),
      ctaUrl: z.string().url(),
      ctaLabel: z.string(),
    }),
  },
} as const;

export type MarketingTemplateKey = keyof typeof marketingTemplateRegistry;
