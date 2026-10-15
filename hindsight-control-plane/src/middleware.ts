import type { NextRequest } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

// Issue #10: the Supabase session lives in the browser (supabase-js), so the
// middleware can't read it. Auth is enforced where the token actually travels:
// the browser forwards the Supabase access token on every /api call, and the
// proxy routes reject a missing/invalid token with 401 (client-side api.ts then
// redirects to /login). The middleware now only does locale routing for pages.
const intlMiddleware = createIntlMiddleware(routing);

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return;
  }
  return intlMiddleware(request);
}

export const config = {
  matcher:
    "/((?!_next|_vercel|.*\\.(?:png|jpe?g|gif|svg|webp|ico|css|js|map|woff2?|ttf|eot|txt|xml|json)$).*)",
};
