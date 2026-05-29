import { NextResponse } from "next/server";
import { enqueue } from "@workspace/worker-queue";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const id = await enqueue("cleanup.expired-sessions", {});
  return NextResponse.json({ enqueued: id });
}
