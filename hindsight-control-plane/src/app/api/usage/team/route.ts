import { NextResponse } from "next/server";

import { DATAPLANE_URL } from "@/lib/hindsight-client";

/**
 * Public: no session. Proxies the unauthenticated team-usage read and does not
 * attach a bearer token.
 */
export async function GET(request: Request) {
  const range = new URL(request.url).searchParams.get("range");
  const query = range ? `?range=${encodeURIComponent(range)}` : "";
  try {
    const res = await fetch(`${DATAPLANE_URL}/v1/default/usage/team${query}`, { cache: "no-store" });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json({ detail: "Team usage is unavailable." }, { status: 503 });
  }
}
