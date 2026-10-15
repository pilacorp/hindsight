import { NextRequest, NextResponse } from "next/server";

import { localizeApiErrorPayload } from "@/lib/i18n/api-errors";
import { DATAPLANE_URL } from "@/lib/hindsight-client";
import {
  SESSION_COOKIE,
  encryptSession,
  sessionCookieOptions,
  type SessionData,
} from "@/lib/auth/nda-session";

/**
 * Multi-user login: the caller presents their own API key. We classify it
 * against the dataplane — a user key via /ext/nda/v1/me, else an admin key via
 * /ext/nda/v1/admin/whoami — and, on success, store it in an encrypted,
 * request-scoped session cookie. There is no shared access key.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.HINDSIGHT_CP_SESSION_SECRET;
  if (!secret) {
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "Session secret not configured",
        errorKey: "api.errors.auth.accessKeyNotConfigured",
      }),
      { status: 503 }
    );
  }

  let body: { key?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "Invalid request body",
        errorKey: "api.errors.auth.invalidRequestBody",
      }),
      { status: 400 }
    );
  }

  const key = body.key?.trim();
  if (!key) {
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "Missing key",
        errorKey: "api.errors.auth.invalidAccessKey",
      }),
      { status: 400 }
    );
  }

  const classified = await classify(key);
  if (!classified) {
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "Invalid key",
        errorKey: "api.errors.auth.invalidAccessKey",
      }),
      { status: 401 }
    );
  }

  const session: Omit<SessionData, "iat"> = {
    kind: classified.kind,
    handle: classified.handle,
    apiKey: key,
  };
  const response = NextResponse.json({ kind: classified.kind, handle: classified.handle });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: await encryptSession(session, secret),
    ...sessionCookieOptions(isSecure(request)),
  });
  return response;
}

async function classify(
  key: string
): Promise<{ kind: "user" | "admin"; handle: string | null } | null> {
  const headers = { Authorization: `Bearer ${key}` };
  const me = await fetch(`${DATAPLANE_URL}/ext/nda/v1/me`, { headers }).catch(() => null);
  if (me && me.ok) {
    const data = (await me.json().catch(() => ({}))) as { handle?: string };
    return { kind: "user", handle: data.handle ?? null };
  }
  const admin = await fetch(`${DATAPLANE_URL}/ext/nda/v1/admin/whoami`, { headers }).catch(
    () => null
  );
  if (admin && admin.ok) {
    return { kind: "admin", handle: null };
  }
  return null;
}

function isSecure(request: NextRequest): boolean {
  const proto = request.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0]?.trim().toLowerCase() === "https";
  return request.nextUrl.protocol === "https:";
}
