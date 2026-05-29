import { NextResponse } from "next/server";
import { prisma } from "@workspace/database";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  return NextResponse.json(
    { status: dbOk ? "ready" : "not-ready", db: dbOk },
    { status: dbOk ? 200 : 503 },
  );
}
