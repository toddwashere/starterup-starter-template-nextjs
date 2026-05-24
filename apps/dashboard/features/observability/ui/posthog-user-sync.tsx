"use client";

import { identify, reset } from "@workspace/observability/posthog";
import { useEffect } from "react";
import { authClient } from "@/features/auth/data/auth-client";

export function PostHogUserSync() {
  const { data: session } = authClient.useSession();

  const userId = session?.user?.id;
  const userEmail = session?.user?.email;

  useEffect(() => {
    if (userId) {
      identify(userId, { email: userEmail ?? undefined });
    } else {
      reset();
    }
  }, [userId, userEmail]);

  return null;
}
