import type { Metadata } from "next";
import { getPreferencePageContext } from "@workspace/campaigns";
import { PreferencePageContent } from "@/features/campaigns/public/preference-page-content";

export const metadata: Metadata = {
  title: "Email preferences",
  description: "Manage your marketing email preferences.",
};

export default async function EmailPreferencesPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <p className="text-muted-foreground">This preference link is invalid or missing.</p>
      </main>
    );
  }

  try {
    const context = await getPreferencePageContext(token);
    return <PreferencePageContent token={token} context={context} />;
  } catch {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <p className="text-muted-foreground">This preference link is invalid or has expired.</p>
      </main>
    );
  }
}
