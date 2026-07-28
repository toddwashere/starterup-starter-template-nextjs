"use client";

import { useEffect, useState } from "react";
import { fetchSystemStatus } from "../data/fetch-system-status";
import type { CheckState, SystemStatus } from "../data/system-status";
import { AppLogo } from "@workspace/ui/components/app-logo";
import { Badge } from "@workspace/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";

function stateBadgeVariant(
  state: CheckState,
): "default" | "secondary" | "destructive" | "outline" {
  switch (state) {
    case "ready":
    case "configured":
    case "enabled":
      return "default";
    case "not-ready":
      return "destructive";
  }
}

function stateDotClass(state: CheckState): string {
  switch (state) {
    case "ready":
    case "configured":
    case "enabled":
      return "size-3 shrink-0 rounded-full bg-green-500";
    case "not-ready":
      return "size-3 shrink-0 rounded-full bg-destructive";
  }
}

export function StatusPageContent() {
  const [status, setStatus] = useState<SystemStatus | null>(null);

  useEffect(() => {
    let isMounted = true;

    fetchSystemStatus().then((nextStatus) => {
      if (isMounted) {
        setStatus(nextStatus);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const overallReady = status?.status === "ready";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/30 px-4 py-10">
      <AppLogo size="lg" />
      <Card className="w-full max-w-xl">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-3xl">System Status</CardTitle>
            </div>
            <Badge variant={overallReady ? "default" : "destructive"}>
              {status ? status.status : "checking"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {!status && (
            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">
                Checking system status...
              </p>
            </div>
          )}
          {status?.checks.map((check) => (
            <div key={check.id} className="rounded-lg border p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{check.label}</p>
                    <Badge variant={stateBadgeVariant(check.state)}>
                      {check.state}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {check.message}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {check.latencyMs != null && (
                    <p
                      className="text-sm tabular-nums text-muted-foreground"
                      aria-label={`${check.label} latency ${check.latencyMs} milliseconds`}
                    >
                      {check.latencyMs} ms
                    </p>
                  )}
                  <span
                    className={stateDotClass(check.state)}
                    aria-label={`${check.label}: ${check.state}`}
                  />
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
