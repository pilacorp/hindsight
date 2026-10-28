import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";
import { stripBasePath } from "@/lib/base-path";
import { apiAuthDecision } from "@/lib/public-api";

// Issue #10: the Supabase session lives in the browser (supabase-js); the
// browser forwards its access token as `Authorization: Bearer <jwt>` on every
// /api call. The proxy routes derive the dataplane token from that header and
// would otherwise throw NoSessionError (→ 500) when it is absent, so gate here:
// an /api request without a bearer gets a clean 401, which the client turns into
// a sign-in redirect. Page routes are not gated (auth is enforced client-side).
const intlMiddleware = createIntlMiddleware(routing);

export function middleware(request: NextRequest) {
  const appPath = stripBasePath(request.nextUrl.pathname);
  const decision = apiAuthDecision(appPath, request.headers.get("authorization"));

  if (decision === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (decision === "allow") {
    return;
  }

  return intlMiddleware(request);
}

export const config = {
  matcher:
    "/((?!_next|_vercel|.*\\.(?:png|jpe?g|gif|svg|webp|ico|css|js|map|woff2?|ttf|eot|txt|xml|json)$).*)",
};
