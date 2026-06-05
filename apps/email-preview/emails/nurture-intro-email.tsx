import { NurtureIntroEmail } from "@workspace/email/templates/marketing/nurture-intro-email";

export default function Preview() {
  return (
    <NurtureIntroEmail
      organizationName="Acme Corp"
      bodyIntro="Thanks for connecting with us. Here is a quick intro to what we do."
      ctaUrl="https://example.com/learn-more"
      ctaLabel="Learn more"
      unsubscribeUrl="https://www.example.com/email/preferences?token=preview"
    />
  );
}
