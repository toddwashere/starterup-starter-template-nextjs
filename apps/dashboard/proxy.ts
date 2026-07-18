import { type NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "better-auth.session_token";
const SESSION_COOKIE_SECURE = "__Secure-better-auth.session_token";

const publicPaths = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/accept-invitation",
  "/status",
  "/api/ready",
  "/api/status",
  "/dev",
];

const authPaths = ["/sign-in", "/sign-up"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/clear-session") ||
    pathname.startsWith("/.well-known/")
  ) {
    return NextResponse.next();
  }

  const sessionCookie =
    request.cookies.get(SESSION_COOKIE) ??
    request.cookies.get(SESSION_COOKIE_SECURE);
  const isAuthenticated = !!sessionCookie?.value;

  const isPublicPath = publicPaths.some((p) => pathname.startsWith(p));
  const isAuthPath = authPaths.some((p) => pathname.startsWith(p));

  if (isAuthenticated && isAuthPath) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (!isAuthenticated && !isPublicPath) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|static|favicon\\.ico).*)"],
};
