import { NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/nda-session";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ success: true });
  const secure = request.nextUrl.protocol === "https:";
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    ...sessionCookieOptions(secure),
    maxAge: 0,
  });
  return response;
}
