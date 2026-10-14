/**
 * Next.js instrumentation file - runs exactly once at server startup.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  const dataplaneUrl = process.env.HINDSIGHT_CP_DATAPLANE_API_URL || "http://localhost:8888";
  const hasSessionSecret = !!process.env.HINDSIGHT_CP_SESSION_SECRET;

  console.log(`[Control Plane] Connecting to dataplane at: ${dataplaneUrl}`);
  if (hasSessionSecret) {
    console.log("[Control Plane] Per-user login enabled (request-scoped auth)");
  } else {
    console.error("[Control Plane] HINDSIGHT_CP_SESSION_SECRET is not set — login is disabled");
  }
}
