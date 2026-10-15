/**
 * Thin proxy from the Control Plane's /api/admin/* routes to the dataplane's
 * management API (/ext/nda/v1/admin/*), authenticated with the current admin
 * session's own key. The dataplane is the source of truth; these routes add
 * no logic beyond forwarding and shaping the response.
 */

import { NextResponse } from "next/server";

import { DATAPLANE_URL, getDataplaneHeaders } from "@/lib/hindsight-client";

const BASE = `${DATAPLANE_URL}/ext/nda/v1`;

type Method = "GET" | "POST" | "PATCH" | "DELETE";

export async function proxyAdmin(
  method: Method,
  path: string,
  body?: unknown
): Promise<NextResponse> {
  let headers: Record<string, string>;
  try {
    headers = await getDataplaneHeaders(
      body !== undefined ? { "Content-Type": "application/json" } : undefined
    );
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let upstream: Response;
  try {
    upstream = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "dataplane unreachable" }, { status: 502 });
  }
  const text = await upstream.text();
  const data = text ? safeJson(text) : null;
  return NextResponse.json(data ?? {}, { status: upstream.status });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}
