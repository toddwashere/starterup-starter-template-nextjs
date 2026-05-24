"use client";

import { setUser } from "@workspace/observability/capture";
import { useEffect } from "react";
import { authClient } from "@/features/auth/data/auth-client";

export function SentryUserSync() {
  const { data: session } = authClient.useSession();

  // Key the effect on the primitive id/email so it only re-syncs on a genuine
  // identity change — better-auth returns a new user object reference on every
  // refetch, which would otherwise re-run this on each window focus.
  const userId = session?.user?.id;
  const userEmail = session?.user?.email;

  useEffect(() => {
    if (userId) {
      setUser({ id: userId, email: userEmail ?? undefined });
    } else {
      setUser(null);
    }
  }, [userId, userEmail]);

  return null;
}
