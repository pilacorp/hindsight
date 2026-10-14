import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { localizeApiErrorPayload } from "@/lib/i18n/api-errors";
import createIntlMiddleware from "next-intl/middleware";
import { SESSION_COOKIE, decryptSession, type SessionData } from "@/lib/auth/nda-session";
import { stripBasePath, withBasePath } from "@/lib/base-path";
import { routing } from "@/i18n/routing";

// Reachable without a session.
const PUBLIC_PATTERNS = [
  "/login",
  "/api/auth/",
  "/api/health",
  "/api/version",
  "/logo.png",
  "/favicon",
  "/_next",
  "/fonts",
  "/static",
];

// Admin-only prefixes; a user session is rejected here, a user never sees admin.
const ADMIN_PATTERNS = ["/admin", "/api/admin"];

const intlMiddleware = createIntlMiddleware(routing);

function isAdminPath(path: string): boolean {
  return ADMIN_PATTERNS.some((p) => path === p || path.startsWith(p + "/"));
}

export async function middleware(request: NextRequest) {
  const secret = process.env.HINDSIGHT_CP_SESSION_SECRET || "";
  const { pathname } = request.nextUrl;
  const appPathname = stripBasePath(pathname);

  const session: SessionData | null = secret
    ? await decryptSession(request.cookies.get(SESSION_COOKIE)?.value, secret)
    : null;
  const isPublic = PUBLIC_PATTERNS.some((pattern) => appPathname.startsWith(pattern));

  // API routes: enforce auth directly (no i18n).
  if (appPathname.startsWith("/api/")) {
    if (isPublic) return NextResponse.next();
    if (!session) return unauthorized(request);
    if (isAdminPath(appPathname) && session.kind !== "admin") return forbidden(request);
    if (!isAdminPath(appPathname) && session.kind === "admin") return forbidden(request);
    return NextResponse.next();
  }

  // Page routes: enforce auth, then hand off to i18n.
  if (!isPublic) {
    if (!session) return redirectToLogin(request, appPathname);
    // An admin may only see admin pages; a user may not see admin pages.
    if (isAdminPath(appPathname) && session.kind !== "admin") return redirectHome(request);
    if (!isAdminPath(appPathname) && session.kind === "admin") return redirectAdmin(request);
  }

  return intlMiddleware(request);
}

function unauthorized(request: NextRequest) {
  return NextResponse.json(
    localizeApiErrorPayload(request, { error: "Unauthorized", errorKey: "api.errors.auth.unauthorized" }),
    { status: 401 }
  );
}

function forbidden(request: NextRequest) {
  return NextResponse.json(
    localizeApiErrorPayload(request, { error: "Forbidden", errorKey: "api.errors.auth.unauthorized" }),
    { status: 403 }
  );
}

function redirectToLogin(request: NextRequest, appPathname: string) {
  const loginUrl = new URL(withBasePath("/login"), request.url);
  loginUrl.searchParams.set("returnTo", appPathname);
  return NextResponse.redirect(loginUrl);
}

function redirectHome(request: NextRequest) {
  return NextResponse.redirect(new URL(withBasePath("/"), request.url));
}

function redirectAdmin(request: NextRequest) {
  return NextResponse.redirect(new URL(withBasePath("/admin"), request.url));
}

export const config = {
  matcher:
    "/((?!_next|_vercel|.*\\.(?:png|jpe?g|gif|svg|webp|ico|css|js|map|woff2?|ttf|eot|txt|xml|json)$).*)",
};
