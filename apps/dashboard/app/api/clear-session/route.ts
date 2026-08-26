import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const SESSION_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"];

export async function GET(request: Request) {
  const cookieStore = await cookies();
  for (const name of SESSION_COOKIES) {
    cookieStore.delete(name);
  }
  return NextResponse.redirect(new URL("/sign-in", request.url));
}
