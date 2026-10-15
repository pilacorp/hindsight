"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-side Supabase client for dashboard sign-in (issue #10). Identity lives
 * in a self-hosted open-source Supabase; the dashboard holds the user's session
 * client-side (supabase-js persists + auto-refreshes it) and forwards its access
 * token as a bearer on every /api call. There is no Hindsight API key anymore.
 *
 * A single client per tab: supabase-js keeps one auth state (localStorage +
 * refresh timer), so constructing it more than once races the token refresh.
 */
let client: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
  }
  client = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

/** Current access token, or null when signed out. Refreshes if near expiry. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  return data.session?.access_token ?? null;
}
