import { NextResponse } from "next/server";

import { DATAPLANE_URL } from "@/lib/hindsight-client";

/**
 * Public: no session required (it is in the middleware allowlist). The
 * dataplane /version endpoint is unauthenticated, so this does not use the
 * request-scoped client — calling it without a session would otherwise throw.
 * Adds whether per-user login is configured so the UI can adapt.
 */
export async function GET() {
  const perUserAuth = !!process.env.HINDSIGHT_CP_SESSION_SECRET;
  try {
    const res = await fetch(`${DATAPLANE_URL}/version`, { cache: "no-store" });
    const data = (res.ok ? await res.json().catch(() => ({})) : {}) as Record<string, unknown>;
    const features = { ...((data.features as Record<string, boolean>) ?? {}), per_user_auth: perUserAuth };
    return NextResponse.json({ ...data, features }, { status: 200 });
  } catch {
    return NextResponse.json({ features: { per_user_auth: perUserAuth } }, { status: 200 });
  }
}
