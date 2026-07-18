"use client";

import { useEffect, useState } from "react";
import { fetchSystemStatus } from "../data/fetch-system-status";
import type { CheckState, SystemStatus } from "../data/system-status";
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
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-3xl">System Status</CardTitle>
              <CardDescription>
                Live readiness checks for core dependencies. Optional
                integrations appear only when configured.
              </CardDescription>
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
                <span
                  className={stateDotClass(check.state)}
                  aria-label={`${check.label}: ${check.state}`}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
