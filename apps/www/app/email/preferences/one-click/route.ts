import { unsubscribeFromToken } from "@workspace/campaigns";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new Response("Missing token", { status: 400 });
  }

  const listUnsubscribe = req.headers.get("List-Unsubscribe");
  if (listUnsubscribe !== "One-Click") {
    return new Response("Invalid List-Unsubscribe header", { status: 400 });
  }

  try {
    await unsubscribeFromToken(token);
    return new Response(null, { status: 200 });
  } catch {
    return new Response("Invalid token", { status: 400 });
  }
}
