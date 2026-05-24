"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";
import type { SentryAppId } from "../sentry-config";

export function createGlobalError(_appId: SentryAppId) {
  return function GlobalError({
    error,
  }: {
    error: Error & { digest?: string };
  }) {
    useEffect(() => {
      Sentry.captureException(error);
    }, [error]);

    return (
      <html lang="en">
        <body>
          <NextError statusCode={0} />
        </body>
      </html>
    );
  };
}
