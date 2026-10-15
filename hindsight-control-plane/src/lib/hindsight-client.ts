/**
 * Request-scoped Hindsight API client for the Control Plane (issue #10).
 *
 * There is no fixed server-side dataplane credential and no session cookie. The
 * browser signs in with Supabase and forwards that user's access token as
 * `Authorization: Bearer <jwt>` on every /api call; these proxy routes read it
 * off the incoming request with `headers()` from `next/headers` (resolved per
 * request from async context) and forward it to the dataplane, where the
 * Supabase tenant extension maps it to the user's schema.
 */

import { headers } from "next/headers";
import {
  HindsightClient,
  HindsightError,
  createClient,
  createConfig,
  sdk,
} from "@vectorize-io/hindsight-client";

export const DATAPLANE_URL = process.env.HINDSIGHT_CP_DATAPLANE_API_URL || "http://localhost:8888";

/** Raised when a request reaches a dataplane accessor without a bearer token. */
export class NoSessionError extends Error {
  constructor() {
    super("no authenticated session");
    this.name = "NoSessionError";
  }
}

/** The current request's Supabase access token, forwarded by the browser. */
export async function getRequestToken(): Promise<string> {
  const auth = (await headers()).get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) throw new NoSessionError();
  return token;
}

/** Auth headers for direct fetch calls to the dataplane, scoped to this request. */
export async function getDataplaneHeaders(
  extra?: Record<string, string>
): Promise<Record<string, string>> {
  return { ...extra, Authorization: `Bearer ${await getRequestToken()}` };
}

/**
 * Build a dataplane URL for a bank-scoped endpoint with the bank id properly
 * encoded. Bank ids may contain `:`, `/`, `%`, etc.
 */
export function dataplaneBankUrl(bankId: string, suffix = ""): string {
  return `${DATAPLANE_URL}/v1/default/banks/${encodeURIComponent(bankId)}${suffix}`;
}

/** Low-level SDK client scoped to the current request. */
export async function getClient() {
  return createClient(
    createConfig({
      baseUrl: DATAPLANE_URL,
      headers: { Authorization: `Bearer ${await getRequestToken()}` },
    })
  );
}

/** High-level client scoped to the current request. */
export async function getHindsightClient() {
  return new HindsightClient({ baseUrl: DATAPLANE_URL, apiKey: await getRequestToken() });
}

export { sdk, HindsightError };
