"use client";

import { formatDate } from "@workspace/common";
import { Badge } from "@workspace/ui/components/badge";

type StepStat = {
  stepId: string;
  sortOrder: number;
  sends: number;
  delivered: number;
  failed: number;
  skipped: number;
  clicks: number;
};

type EnrollmentCounts = Record<string, number>;

export function SequenceStatsPanel({
  enrollmentCounts,
  perStep,
}: {
  enrollmentCounts: EnrollmentCounts;
  perStep: StepStat[];
}) {
  const totalEnrollments = Object.values(enrollmentCounts).reduce((sum, n) => sum + n, 0);

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <h3 className="font-semibold">Performance</h3>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Enrollments" value={totalEnrollments} />
        <StatCard label="Active" value={enrollmentCounts.active ?? 0} />
        <StatCard label="Completed" value={enrollmentCounts.completed ?? 0} />
        <StatCard label="Exited" value={enrollmentCounts.exited ?? 0} />
      </div>

      {perStep.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Step</th>
                <th className="py-2 pr-4 font-medium">Sends</th>
                <th className="py-2 pr-4 font-medium">Delivered</th>
                <th className="py-2 pr-4 font-medium">Failed</th>
                <th className="py-2 pr-4 font-medium">Clicks</th>
              </tr>
            </thead>
            <tbody>
              {perStep.map((step) => (
                <tr key={step.stepId} className="border-b last:border-0">
                  <td className="py-2 pr-4">Step {step.sortOrder + 1}</td>
                  <td className="py-2 pr-4">{step.sends}</td>
                  <td className="py-2 pr-4">{step.delivered}</td>
                  <td className="py-2 pr-4">{step.failed}</td>
                  <td className="py-2 pr-4">{step.clicks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}

export function SequenceStatusBadge({ status }: { status: string }) {
  const variant =
    status === "active"
      ? "default"
      : status === "paused"
        ? "secondary"
        : status === "archived"
          ? "outline"
          : "secondary";

  return (
    <Badge variant={variant} className="capitalize">
      {status}
    </Badge>
  );
}

export function CampaignRunStatusBadge({
  status,
  startedAt,
}: {
  status: string;
  startedAt?: Date | string | null;
}) {
  return (
    <div className="space-y-1">
      <Badge variant="outline" className="capitalize">
        {status}
      </Badge>
      {startedAt && (
        <p className="text-xs text-muted-foreground">Started {formatDate(startedAt)}</p>
      )}
    </div>
  );
}
