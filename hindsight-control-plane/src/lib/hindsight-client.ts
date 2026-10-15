/**
 * Request-scoped Hindsight API client for the NDA multi-user Control Plane.
 *
 * There is no fixed server-side dataplane credential. Each request builds its
 * client and headers from the current session cookie, so the dataplane sees the
 * logged-in user's (or admin's) own API key. The session is read with
 * `cookies()` from `next/headers`, which resolves per request from async
 * context, so route handlers need no extra plumbing.
 */

import { cookies } from "next/headers";
import {
  HindsightClient,
  HindsightError,
  createClient,
  createConfig,
  sdk,
} from "@vectorize-io/hindsight-client";

import { SESSION_COOKIE, decryptSession } from "@/lib/auth/nda-session";

export const DATAPLANE_URL = process.env.HINDSIGHT_CP_DATAPLANE_API_URL || "http://localhost:8888";

/** Raised when a request reaches a dataplane accessor without a valid session. */
export class NoSessionError extends Error {
  constructor() {
    super("no authenticated session");
    this.name = "NoSessionError";
  }
}

/** The current request's API key, from the encrypted session cookie. */
export async function getSessionApiKey(): Promise<string> {
  const secret = process.env.HINDSIGHT_CP_SESSION_SECRET || "";
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await decryptSession(token, secret);
  if (!session) throw new NoSessionError();
  return session.apiKey;
}

/**
 * Auth headers for direct fetch calls to the dataplane, scoped to this request.
 * (Now async — callers add `await`.)
 */
export async function getDataplaneHeaders(
  extra?: Record<string, string>
): Promise<Record<string, string>> {
  return { ...extra, Authorization: `Bearer ${await getSessionApiKey()}` };
}

/**
 * Build a dataplane URL for a bank-scoped endpoint with the bank id properly
 * encoded. Bank ids may contain `:`, `/`, `%`, etc.
 */
export function dataplaneBankUrl(bankId: string, suffix = ""): string {
  return `${DATAPLANE_URL}/v1/default/banks/${encodeURIComponent(bankId)}${suffix}`;
}

/** Low-level SDK client scoped to the current request. Replaces `lowLevelClient`. */
export async function getClient() {
  return createClient(
    createConfig({
      baseUrl: DATAPLANE_URL,
      headers: { Authorization: `Bearer ${await getSessionApiKey()}` },
    })
  );
}

/** High-level client scoped to the current request. Replaces `hindsightClient`. */
export async function getHindsightClient() {
  return new HindsightClient({ baseUrl: DATAPLANE_URL, apiKey: await getSessionApiKey() });
}

export { sdk, HindsightError };
