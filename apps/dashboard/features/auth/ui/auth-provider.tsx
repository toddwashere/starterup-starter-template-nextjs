"use client";

import NiceModal from "@ebay/nice-modal-react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@workspace/ui/components/theme-provider";
import { Toaster } from "@workspace/ui/components/sonner";
import type { ReactNode } from "react";
import { getQueryClient } from "../data/query-client";
import { GlobalCommandMenu } from "@/features/command-menu/global-command-menu";
import { PostHogUserSync } from "@/features/observability/ui/posthog-user-sync";
import { SentryUserSync } from "@/features/observability/ui/sentry-user-sync";

export function Providers({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <SentryUserSync />
        <PostHogUserSync />
        <NiceModal.Provider>
          <GlobalCommandMenu>
            {children}
          </GlobalCommandMenu>
        </NiceModal.Provider>
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
