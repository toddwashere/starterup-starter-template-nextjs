import type { ReactElement } from "react";
import { z } from "zod";
import { NurtureIntroEmailBody } from "../templates/marketing/nurture-intro-email";

export const marketingTemplateRegistry = {
  "nurture-intro": {
    label: "Nurture intro",
    description: "Short intro with single CTA",
    propsSchema: z.object({
      bodyIntro: z.string(),
      ctaUrl: z.string().url(),
      ctaLabel: z.string(),
    }),
    renderBody: (props: {
      bodyIntro: string;
      ctaUrl: string;
      ctaLabel: string;
    }): ReactElement => <NurtureIntroEmailBody {...props} />,
    previewFromProps: (props: { bodyIntro: string }) => props.bodyIntro.slice(0, 100),
  },
} as const;

export type MarketingTemplateKey = keyof typeof marketingTemplateRegistry;

export function listMarketingTemplates() {
  return Object.entries(marketingTemplateRegistry).map(([key, entry]) => ({
    key,
    label: entry.label,
    description: entry.description,
    propsSchema: entry.propsSchema,
  }));
}
