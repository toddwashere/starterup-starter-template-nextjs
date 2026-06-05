"use client";

import { useEffect, useState } from "react";
import {
  type DatabaseReadinessStatus,
  getDatabaseReadinessStatus,
} from "../data/readiness-status";
import { Badge } from "@workspace/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";

type StatusState = DatabaseReadinessStatus | null;

export function StatusPageContent() {
  const [status, setStatus] = useState<StatusState>(null);

  useEffect(() => {
    let isMounted = true;

    getDatabaseReadinessStatus().then((nextStatus) => {
      if (isMounted) {
        setStatus(nextStatus);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const databaseConnected = status?.databaseConnected === true;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-3xl">System Status</CardTitle>
              <CardDescription>
                Live readiness checks for dashboard dependencies.
              </CardDescription>
            </div>
            <Badge variant={databaseConnected ? "default" : "destructive"}>
              {status ? status.status : "checking"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">Database connection</p>
                <p className="text-sm text-muted-foreground">
                  {status?.message ?? "Checking database connection..."}
                </p>
              </div>
              <span
                className={
                  databaseConnected
                    ? "size-3 rounded-full bg-green-500"
                    : "size-3 rounded-full bg-destructive"
                }
                aria-label={
                  databaseConnected
                    ? "Database connected"
                    : "Database disconnected"
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
