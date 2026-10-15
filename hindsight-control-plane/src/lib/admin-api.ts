"use client";

import { withBasePath } from "@/lib/base-path";

/**
 * fetch for the admin pages. On 401 (session expired or revoked) it clears the
 * session and sends the browser to /login, so a stale admin session does not
 * sit on a page silently failing. Returns the Response for the caller to read;
 * throws only on a network error.
 */
export async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(withBasePath(path), { cache: "no-store", ...init });
  if (res.status === 401) {
    try {
      await fetch(withBasePath("/api/auth/logout"), { method: "POST" });
    } catch {
      // ignore; redirect regardless
    }
    window.location.href = withBasePath("/login");
  }
  return res;
}

export async function logout(): Promise<void> {
  try {
    await fetch(withBasePath("/api/auth/logout"), { method: "POST" });
  } finally {
    window.location.href = withBasePath("/login");
  }
}
