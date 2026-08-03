import type { Metadata } from "next";
import { Suspense } from "react";
import { SignInPageContent } from "@/features/auth/ui/sign-in-page-content";

export const metadata: Metadata = { title: "Sign In" };

export default function SignInPage() {
  return (
    <Suspense>
      <SignInPageContent />
    </Suspense>
  );
}
