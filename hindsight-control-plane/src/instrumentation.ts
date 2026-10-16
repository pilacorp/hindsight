/**
 * Next.js instrumentation file - runs exactly once at server startup.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  const dataplaneUrl = process.env.HINDSIGHT_CP_DATAPLANE_API_URL || "http://localhost:8888";
  const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

  console.log(`[Control Plane] Connecting to dataplane at: ${dataplaneUrl}`);
  // Issue #10: sign-in is Supabase Auth (client-side). The browser needs the
  // public URL/anon key; without them the login page cannot sign anyone in.
  if (hasSupabase) {
    console.log("[Control Plane] Supabase sign-in enabled");
  } else {
    console.error(
      "[Control Plane] NEXT_PUBLIC_SUPABASE_URL is not set — sign-in is disabled (build the image with the Supabase build args)"
    );
  }
}
