import { NextResponse } from "next/server";
import { getSystemStatus } from "@/features/status/data/probe-system-status";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const status = await getSystemStatus();
  return NextResponse.json(status, {
    status: status.status === "ready" ? 200 : 503,
  });
}
